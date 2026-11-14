import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { CairnHome } from './cairn-home';
import type { SiteAddress } from './cairn-site';
import { ClaudeSettings } from './claude-settings';
import type { DeviceKind, DeviceLogin } from './device-login';
import { CliError, type Terminal } from './terminal';

/** cairn status가 보일 기기 하나의 상태 */
export abstract class DeviceState {
  /** 기기 이름. 없으면 null */
  readonly device: string | null;
  readonly site: string | null;
  /** 서버가 갱신을 거절해 다시 만들어야 한다 */
  readonly dead: boolean;

  /** saved: credentials.json에 둔 그 기기의 열쇠 */
  constructor(saved: Record<string, unknown> | undefined) {
    this.device = saved ? String(saved.device ?? '') : null;
    this.site = saved ? String(saved.site ?? '') : null;
    this.dead = Boolean(saved?.dead);
  }

  /** cairn status의 줄들 */
  abstract get lines(): string[];

  protected deviceLine(kind: DeviceKind): string {
    const device = this.device
      ? `${this.device} · ${this.site}${this.dead ? ' · 끊김 (cairn connect로 다시)' : ''}`
      : '없음';
    return `  ${kind.label}: ${device}`;
  }
}

// cairn connect의 기기 단계 하나 (Claude Code만): 그 권한만 가진 기기 · ~/.cairn/bin의 스크립트 · settings.json의 훅.
// 기기가 이미 있으면(같은 블로그, 끊기지 않음) 다시 만들지 않고, 사람이 없는 곳에서는 기기 없이 훅만 건다
// (훅은 열쇠가 생기면 그때부터 돈다). 사용자의 훅 · 상태 줄은 지우거나 덮지 않는다.
export abstract class DeviceSetup {
  protected abstract readonly kind: DeviceKind;
  /** 설정 파일을 읽지 못했을 때 "…을 걸지 않았어요"에 넣을 말 */
  protected abstract readonly hooksLabel: string;
  protected readonly settings: ClaudeSettings;
  protected readonly home: CairnHome;

  constructor(
    protected readonly terminal: Terminal,
    /** Claude Code의 사용자 설정 (~/.claude/settings.json) */
    settingsFile: string,
    private readonly login: DeviceLogin,
    cairnDir = join(homedir(), '.cairn'),
  ) {
    this.settings = new ClaudeSettings(settingsFile);
    this.home = new CairnHome(cairnDir);
  }

  /** withDevice: 브라우저로 기기를 만들 수 있는 곳인가 (사람이 있는 터미널) */
  async run(at: SiteAddress, withDevice: boolean): Promise<void> {
    const t = this.terminal;
    this.home.installScripts();
    const saved = this.saved();
    if (saved?.site === at.site && !saved.dead)
      t.done(`${this.kind.label} ${String(saved.device)} · 이미 연결됨`);
    else if (!withDevice)
      t.say(
        `${this.kind.label}는 직접 입력할 수 있는 터미널에서 cairn connect를 다시 실행하면 만들어요`,
      );
    else await this.createDevice(at);
    const settings = this.settings.read();
    if (settings === null) {
      t.say(
        `${this.settings.file}을 읽지 못해 ${this.hooksLabel}을 걸지 않았어요 (JSON 모양을 봐 주세요)`,
      );
      return;
    }
    if (this.attach(settings)) this.settings.write(settings);
  }

  /** cairn status가 보일 것 */
  abstract state(): DeviceState;

  /** 설정에 훅(과 상태 줄)을 걸고 알린다. 설정을 바꿨으면 true (그때만 파일을 다시 쓴다) */
  protected abstract attach(settings: Record<string, unknown>): boolean;

  /** credentials.json에 둔 이 기기의 열쇠 */
  protected saved(): Record<string, unknown> | undefined {
    return this.home.credentials()[this.kind.scope] as Record<string, unknown> | undefined;
  }

  /**
   * 브라우저로 기기를 승인받아 열쇠를 둔다. 못 만들면 까닭만 알리고 이어 간다:
   * 연결은 이미 끝났고, 훅은 열쇠가 생기면 그때부터 돈다
   */
  private async createDevice(at: SiteAddress): Promise<void> {
    const name = `${hostname().split('.')[0] || '내 컴퓨터'} · ${this.kind.suffix}`;
    try {
      const credential = await this.login.run(at, name, this.kind);
      this.home.saveCredential(this.kind.scope, credential.toJSON());
      this.terminal.done(`${this.kind.label} ${name} (${this.kind.permission})`);
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      this.terminal.say(`✗ ${error.message}`);
    }
  }
}
