import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import type { SiteAddress } from './cairn-site';
import type { NewsLogin } from './news-login';
import { CliError, type Terminal } from './terminal';

/** 이 컴퓨터의 소식 단계 상태 (cairn status) */
export class NewsState {
  constructor(
    /** 소식 기기 이름. 없으면 null */
    readonly device: string | null,
    readonly site: string | null,
    /** 서버가 갱신을 거절해 다시 만들어야 한다 */
    readonly dead: boolean,
    readonly hook: boolean,
    /** 상태 줄: ours(우리 것) · other(사용자 것) · none */
    readonly statusLine: string,
  ) {}

  /** cairn status의 줄들 */
  get lines(): string[] {
    const device = this.device
      ? `${this.device} · ${this.site}${this.dead ? ' · 끊김 (cairn connect로 다시)' : ''}`
      : '없음';
    const line = { ours: '있음', other: '사용자의 것 (Cairn 소식 없음)', none: '없음' }[
      this.statusLine
    ];
    return [
      `  소식 기기: ${device}`,
      `  소식 훅: ${this.hook ? '있음' : '없음'} · 상태 줄: ${line}`,
    ];
  }
}

// cairn connect의 소식 단계 (2차 1-3, Claude Code만): 소식 기기 · 훅 · 상태 줄.
//   ~/.cairn/bin/*.mjs         훅 · 상태 줄 스크립트 (이 명령에 든 news/를 그대로 복사, 늘 새로 쓴다)
//   ~/.cairn/credentials.json  소식 기기의 열쇠 (0600). 다른 키는 그대로 둔다
//   ~/.claude/settings.json    UserPromptSubmit 훅을 더하고(있던 훅은 그대로), 상태 줄이 없을 때만 건다
// 사용자의 훅 · 상태 줄을 지우거나 덮지 않는다. 우리 것은 명령의 스크립트 경로로 알아본다.
export class NewsSetup {
  private static readonly SCRIPT = 'cairn-news.mjs';
  /** Claude Code가 훅을 기다리는 시간(초). 스크립트는 2초 안에 스스로 끝낸다 */
  private static readonly HOOK_SECONDS = 5;
  private static readonly SOURCE = join(__dirname, '../news');

  constructor(
    private readonly terminal: Terminal,
    /** Claude Code의 사용자 설정 (~/.claude/settings.json) */
    private readonly settingsFile: string,
    private readonly login: NewsLogin,
    private readonly cairnDir = join(homedir(), '.cairn'),
  ) {}

  private get script(): string {
    return join(this.cairnDir, 'bin', NewsSetup.SCRIPT);
  }

  private get credentialsFile(): string {
    return join(this.cairnDir, 'credentials.json');
  }

  private command(mode: 'hook' | 'status'): string {
    return `node "${this.script}" ${mode}`;
  }

  /** withDevice: 브라우저로 소식 기기를 만들 수 있는 곳인가 (사람이 있는 터미널) */
  async run(at: SiteAddress, withDevice: boolean): Promise<void> {
    const t = this.terminal;
    this.installScripts();
    const news = this.credentials().news as Record<string, unknown> | undefined;
    if (news?.site === at.site && !news.dead)
      t.done(`소식 기기 ${String(news.device)} · 이미 연결됨`);
    else if (!withDevice)
      t.say('소식 기기는 직접 입력할 수 있는 터미널에서 cairn connect를 다시 실행하면 만들어요');
    else await this.createDevice(at);
    const settings = this.readSettings();
    if (settings === null) {
      t.say(
        `${this.settingsFile}을 읽지 못해 훅 · 상태 줄을 걸지 않았어요 (JSON 모양을 봐 주세요)`,
      );
      return;
    }
    const hookAdded = this.addHook(settings);
    const statusLine = this.addStatusLine(settings);
    if (hookAdded || statusLine === 'added') this.writeSettings(settings);
    t.done(hookAdded ? '훅 · 말을 걸 때마다 팀 소식을 덧붙여요' : '훅 · 이미 있음');
    if (statusLine === 'other') {
      t.say(
        '상태 줄이 이미 있어 그대로 뒀어요. Cairn 소식을 함께 보려면 지금 상태 줄 명령에 이 출력을 더해요:',
      );
      t.say(`  ${this.command('status')}`);
    } else t.done(statusLine === 'added' ? '상태 줄 · Cairn · 진행 · 소식' : '상태 줄 · 이미 있음');
  }

  /**
   * 브라우저로 소식 기기를 승인받아 열쇠를 둔다. 못 만들면 까닭만 알리고 이어 간다:
   * 기기 연결은 이미 끝났고, 훅 · 상태 줄은 열쇠가 생기면 그때부터 돈다 (상태 줄이 다시 연결하라고 보인다)
   */
  private async createDevice(at: SiteAddress): Promise<void> {
    const name = `${hostname().split('.')[0] || '내 컴퓨터'} · 소식`;
    try {
      const credential = await this.login.run(at, name);
      this.saveCredentials({ ...this.credentials(), news: credential.toJSON() });
      this.terminal.done(`소식 기기 ${name} (소식 읽기만)`);
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      this.terminal.say(`✗ ${error.message}`);
    }
  }

  /** cairn status가 보일 것 */
  state(): NewsState {
    const news = this.credentials().news as Record<string, unknown> | undefined;
    const settings = this.readSettings() ?? {};
    const line = settings.statusLine as { command?: unknown } | undefined;
    return new NewsState(
      news ? String(news.device ?? '') : null,
      news ? String(news.site ?? '') : null,
      Boolean(news?.dead),
      this.hookEntries(settings).some((h) => this.ours(h.command)),
      line === undefined ? 'none' : this.ours(line.command) ? 'ours' : 'other',
    );
  }

  /** 스크립트는 이 명령에 든 판으로 늘 새로 쓴다 (고친 판이 다음 connect에서 들어가게) */
  private installScripts(): void {
    const bin = join(this.cairnDir, 'bin');
    mkdirSync(bin, { recursive: true, mode: 0o700 });
    for (const file of readdirSync(NewsSetup.SOURCE).filter((f) => f.endsWith('.mjs')))
      copyFileSync(join(NewsSetup.SOURCE, file), join(bin, file));
  }

  /** 우리 스크립트를 부르는 명령인가 (경로가 바뀌었어도) */
  private ours(command: unknown): boolean {
    return typeof command === 'string' && command.includes(NewsSetup.SCRIPT);
  }

  private hookEntries(settings: Record<string, unknown>): { command?: unknown }[] {
    const hooks = (settings.hooks as Record<string, unknown> | undefined)?.UserPromptSubmit;
    if (!Array.isArray(hooks)) return [];
    return hooks.flatMap((group) =>
      Array.isArray((group as { hooks?: unknown }).hooks)
        ? ((group as { hooks: { command?: unknown }[] }).hooks ?? [])
        : [],
    );
  }

  /** 우리 훅을 더한다 (경로가 바뀌었으면 고친다). 바꿨으면 true */
  private addHook(settings: Record<string, unknown>): boolean {
    const command = this.command('hook');
    const mine = this.hookEntries(settings).find((h) => this.ours(h.command));
    if (mine?.command === command) return false;
    if (mine) {
      mine.command = command;
      return true;
    }
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
    const groups = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];
    hooks.UserPromptSubmit = [
      ...groups,
      { hooks: [{ type: 'command', command, timeout: NewsSetup.HOOK_SECONDS }] },
    ];
    settings.hooks = hooks;
    return true;
  }

  /** 상태 줄이 없으면 우리 것을 건다. 사용자의 것이면 건드리지 않는다 */
  private addStatusLine(settings: Record<string, unknown>): 'added' | 'kept' | 'other' {
    const line = settings.statusLine as { command?: unknown } | undefined;
    const command = this.command('status');
    if (line && !this.ours(line.command)) return 'other';
    if (line?.command === command) return 'kept';
    settings.statusLine = { type: 'command', command, padding: 0 };
    return 'added';
  }

  /** 설정 파일. 없으면 빈 것, 읽을 수 없는 모양이면 null (건드리지 않는다) */
  private readSettings(): Record<string, unknown> | null {
    if (!existsSync(this.settingsFile)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.settingsFile, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private writeSettings(settings: Record<string, unknown>): void {
    mkdirSync(join(this.settingsFile, '..'), { recursive: true });
    const temp = `${this.settingsFile}.cairn.tmp`;
    writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(temp, this.settingsFile);
  }

  private credentials(): Record<string, unknown> {
    try {
      return JSON.parse(readFileSync(this.credentialsFile, 'utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /** 열쇠 파일은 나만 읽게 (0600, 폴더 0700) */
  private saveCredentials(all: Record<string, unknown>): void {
    mkdirSync(this.cairnDir, { recursive: true, mode: 0o700 });
    const temp = `${this.credentialsFile}.tmp`;
    writeFileSync(temp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.credentialsFile);
  }
}
