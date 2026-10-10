import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ArchiveQuery } from '../archive/archive.query';
import type { Sql } from '../base/database';
import type { DomainEvent } from '../base/event';
import type { SecretBox } from '../base/secret-box';
import { BasePlugin } from './base-plugin';
import { PluginRepository } from './plugin.repository';
import {
  type EventSubscription,
  LoginMethod,
  type PluginAction,
  PluginContext,
  type ScheduledJob,
} from './plugin-context';
import { PluginManifest } from './plugin-manifest';
import type { PluginState } from './plugin-state';

// 플러그인 목록과 지금 동작 중인 등록.
//   들어 있는 플러그인(plugins/ 폴더)은 시작할 때 모두 읽고 검사한다 (틀리면 시작하지 않음).
//   켜짐·설정은 DB(platform.plugins)에서 읽고, 바뀌면 reload()로 재시작 없이 다시 등록한다.
//   한 플러그인의 설정이 틀려도 다른 플러그인과 서버는 계속 돈다 (problems()로 원인을 알림).
export class PluginRegistry {
  private subscriptions: readonly EventSubscription[] = [];
  private scheduled: readonly ScheduledJob[] = [];
  private pluginActions: readonly PluginAction[] = [];
  private loginMethods: readonly LoginMethod[] = [];
  private states = new Map<string, PluginState>();
  private failures = new Map<string, string>();

  private constructor(
    private readonly catalog: ReadonlyMap<string, PluginManifest>,
    private readonly sql: Sql,
    private readonly archive: ArchiveQuery,
    private readonly box: SecretBox,
  ) {}

  static async boot(
    pluginsDir: string,
    sql: Sql,
    archive: ArchiveQuery,
    box: SecretBox,
  ): Promise<PluginRegistry> {
    const registry = new PluginRegistry(PluginRegistry.readCatalog(pluginsDir), sql, archive, box);
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
    const scheduled: ScheduledJob[] = [];
    const actions: PluginAction[] = [];
    const logins: LoginMethod[] = [];
    const failures = new Map<string, string>();
    for (const state of states) {
      const manifest = this.catalog.get(state.name);
      if (!manifest?.server || !state.isActiveFor(manifest)) continue;
      try {
        const context = new PluginContext(
          manifest,
          state.resolve(manifest, this.box),
          this.archive,
        );
        PluginRegistry.instantiate(manifest).register(context);
        subscriptions.push(...context.subscriptions);
        scheduled.push(...context.jobs);
        actions.push(...context.actions);
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
    this.scheduled = scheduled;
    this.pluginActions = actions;
    this.loginMethods = logins;
    this.failures = failures;
  }

  /** 서버 파일을 불러 BasePlugin 하위 클래스인지 확인하고 만든다 */
  private static instantiate(manifest: PluginManifest): BasePlugin {
    // 플러그인 서버 파일은 실행 중에 정해지므로 require로 불러온다 (개발 중에는 @swc-node/register가 TS를 읽는다)
    const loaded = require(join(manifest.dir, manifest.server ?? '')) as { default?: unknown };
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
}
