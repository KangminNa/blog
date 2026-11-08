import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ArchiveQuery } from '../archive/archive.query';
import type { ArchiveRestoreService } from '../archive/archive-restore.service';
import type { Sql } from '../base/database';
import type { DomainEvent } from '../base/event';
import type { SecretBox } from '../base/secret-box';
import { BasePlugin } from './base-plugin';
import { PluginRepository } from './plugin.repository';
import {
  type EventReaction,
  type EventSubscription,
  LoginMethod,
  type PackageOperation,
  type PluginAction,
  PluginContext,
  type ScheduledJob,
} from './plugin-context';
import { type PackageToolSpec, PluginManifest } from './plugin-manifest';
import type { PluginState } from './plugin-state';

// 플러그인 목록과 지금 동작 중인 등록.
//   들어 있는 플러그인(plugins/ 폴더)은 시작할 때 모두 읽고 검사한다 (틀리면 시작하지 않음).
//   켜짐·설정은 DB(platform.plugins)에서 읽고, 바뀌면 reload()로 재시작 없이 다시 등록한다.
//   한 플러그인의 설정이 틀려도 다른 플러그인과 서버는 계속 돈다 (problems()로 원인을 알림).
export class PluginRegistry {
  private subscriptions: readonly EventSubscription[] = [];
  private reactions: readonly EventReaction[] = [];
  private scheduled: readonly ScheduledJob[] = [];
  private pluginActions: readonly PluginAction[] = [];
  private loginMethods: readonly LoginMethod[] = [];
  private packageOperations: readonly PackageOperation[] = [];
  private states = new Map<string, PluginState>();
  private failures = new Map<string, string>();

  private constructor(
    private readonly catalog: ReadonlyMap<string, PluginManifest>,
    private readonly sql: Sql,
    private readonly archive: ArchiveQuery,
    private readonly box: SecretBox,
    private readonly restore: ArchiveRestoreService,
  ) {}

  static async boot(
    pluginsDir: string,
    sql: Sql,
    archive: ArchiveQuery,
    box: SecretBox,
    restore: ArchiveRestoreService,
  ): Promise<PluginRegistry> {
    const catalog = PluginRegistry.readCatalog(pluginsDir);
    const registry = new PluginRegistry(catalog, sql, archive, box, restore);
    await registry.reload();
    return registry;
  }

  /** plugins/ 안의 모든 플러그인 목록 파일 */
  static readCatalog(pluginsDir: string): ReadonlyMap<string, PluginManifest> {
    const catalog = new Map<string, PluginManifest>();
    if (!existsSync(pluginsDir)) return catalog;
    for (const name of readdirSync(pluginsDir).sort()) {
      const dir = join(pluginsDir, name);
      if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'cairn-plugin.json'))) continue;
      const manifest = PluginManifest.read(dir);
      if (manifest.name !== name) {
        throw new Error(`폴더 이름(${name})과 플러그인 이름(${manifest.name})이 달라요`);
      }
      catalog.set(name, manifest);
    }
    return catalog;
  }

  /** DB의 켜짐·설정을 다시 읽어 등록을 새로 만든다 */
  async reload(): Promise<void> {
    const states = await new PluginRepository(this.sql).all();
    const subscriptions: EventSubscription[] = [];
    const reactions: EventReaction[] = [];
    const scheduled: ScheduledJob[] = [];
    const actions: PluginAction[] = [];
    const logins: LoginMethod[] = [];
    const operations: PackageOperation[] = [];
    const failures = new Map<string, string>();
    for (const state of states) {
      const manifest = this.catalog.get(state.name);
      if (!manifest?.server || !state.isActiveFor(manifest)) continue;
      try {
        const context = new PluginContext(
          manifest,
          state.resolve(manifest, this.box),
          this.archive,
          this.restore,
        );
        PluginRegistry.instantiate(manifest).register(context);
        subscriptions.push(...context.subscriptions);
        reactions.push(...context.reactions);
        scheduled.push(...context.jobs);
        actions.push(...context.actions);
        operations.push(...context.operations);
        for (const login of context.logins) {
          // 같은 이름의 로그인 방법은 먼저 켠 플러그인 것만 쓴다
          if (logins.some((l) => l.name === login.name))
            failures.set(
              state.name,
              `로그인 방법 "${login.name}"은(는) 다른 플러그인이 이미 쓰고 있어요`,
            );
          else logins.push(login);
        }
      } catch (error) {
        failures.set(state.name, (error as Error).message);
      }
    }
    this.states = new Map(states.map((s) => [s.name, s]));
    this.subscriptions = subscriptions;
    this.reactions = reactions;
    this.scheduled = scheduled;
    this.pluginActions = actions;
    this.loginMethods = logins;
    this.packageOperations = operations;
    this.failures = failures;
  }

  /** 서버 파일을 불러 BasePlugin 하위 클래스인지 확인하고 만든다 */
  private static instantiate(manifest: PluginManifest): BasePlugin {
    // 플러그인 서버 파일은 실행 중에 정해지므로 require로 불러온다. 확장자를 빼서 Node가 찾게 한다:
    // 운영 이미지에는 빌드 때 컴파일한 .js가 .ts 옆에 있고, 개발 중에는 @swc-node/register가 .ts를 읽는다
    const entry = join(manifest.dir, manifest.server ?? '').replace(/\.ts$/, '');
    const loaded = require(entry) as { default?: unknown };
    const PluginClass = loaded.default;
    if (typeof PluginClass !== 'function' || !(PluginClass.prototype instanceof BasePlugin)) {
      throw new Error(
        `플러그인 ${manifest.name}의 서버 파일이 BasePlugin을 상속한 클래스를 default로 내보내지 않아요`,
      );
    }
    return new (PluginClass as new (m: PluginManifest) => BasePlugin)(manifest);
  }

  /** 들어 있는 플러그인 전부 */
  installed(): readonly PluginManifest[] {
    return [...this.catalog.values()];
  }

  manifest(name: string): PluginManifest | null {
    return this.catalog.get(name) ?? null;
  }

  /** 마지막으로 읽은 상태 (켜짐·설정) */
  state(name: string): PluginState | null {
    return this.states.get(name) ?? null;
  }

  /** 켜졌는데 동작하지 못한 이유 */
  problem(name: string): string | null {
    return this.failures.get(name) ?? null;
  }

  handlersFor(event: DomainEvent): readonly EventSubscription[] {
    return this.subscriptions.filter((s) => event.matches(s.pattern));
  }

  /** 이 이벤트에 코어가 돌릴 기능 패키지의 동작들 */
  reactionsFor(event: DomainEvent): readonly EventReaction[] {
    return this.reactions.filter((r) => event.matches(r.pattern));
  }

  jobs(): readonly ScheduledJob[] {
    return this.scheduled;
  }

  action(plugin: string, name: string): PluginAction | null {
    return this.pluginActions.find((a) => a.plugin === plugin && a.name === name) ?? null;
  }

  actions(): readonly PluginAction[] {
    return this.pluginActions;
  }

  /** 동작 중인 로그인 방법들 (로그인 화면의 버튼) */
  logins(): readonly LoginMethod[] {
    return this.loginMethods;
  }

  login(name: string): LoginMethod | null {
    return this.loginMethods.find((l) => l.name === name) ?? null;
  }

  /**
   * 기능 패키지의 경로에 맞는 동작과 경로의 값(:id 등). 동작 중인 패키지만 찾는다.
   * route: 목록 파일 api의 열쇠("GET /reads/:id"), path: /api/p/<이름> 뒤의 경로
   */
  operationAt(
    plugin: string,
    method: string,
    path: string,
  ): { found: PackageOperation; params: Record<string, string> } | null {
    const manifest = this.catalog.get(plugin);
    if (!manifest) return null;
    const asked = path.split('/').filter(Boolean);
    for (const [route, name] of manifest.api) {
      const [verb, pattern = ''] = route.split(' ');
      if (verb !== method.toUpperCase()) continue;
      const parts = pattern.split('/').filter(Boolean);
      if (parts.length !== asked.length) continue;
      const params: Record<string, string> = {};
      const fits = parts.every((part, i) => {
        const value = asked[i] ?? '';
        if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(value);
        return part.startsWith(':') || part === value;
      });
      const found = this.packageOperations.find(
        (o) => o.manifest.name === plugin && o.operation.name === name,
      );
      if (fits && found) return { found, params };
    }
    return null;
  }

  /** 동작 중인 기능 패키지의 MCP 도구들 (목록 파일 tools → 등록한 동작) */
  packageTools(): readonly { name: string; spec: PackageToolSpec; found: PackageOperation }[] {
    return this.packageOperations.flatMap((found) =>
      [...found.manifest.tools]
        .filter(([, spec]) => spec.operation === found.operation.name)
        .map(([name, spec]) => ({ name, spec, found })),
    );
  }

  /** 동작 중인 기능 패키지의 콘솔 메뉴 */
  packageMenus(): readonly { plugin: string; menu: NonNullable<PluginManifest['menu']> }[] {
    return [...this.catalog.values()].flatMap((m) => {
      const state = this.states.get(m.name);
      return m.menu && state?.isActiveFor(m) ? [{ plugin: m.name, menu: m.menu }] : [];
    });
  }
}
