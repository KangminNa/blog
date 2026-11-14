import { ClaudeSettings } from './claude-settings';
import { DeviceKind } from './device-login';
import { DeviceSetup, DeviceState } from './device-setup';

/** 이 컴퓨터의 소식 단계 상태 (cairn status) */
export class NewsState extends DeviceState {
  constructor(
    saved: Record<string, unknown> | undefined,
    readonly hook: boolean,
    /** 상태 줄: ours(우리 것) · other(사용자 것) · none */
    readonly statusLine: string,
  ) {
    super(saved);
  }

  get lines(): string[] {
    const line = { ours: '있음', other: '사용자의 것 (Cairn 소식 없음)', none: '없음' }[
      this.statusLine
    ];
    return [
      this.deviceLine(DeviceKind.NEWS),
      `  소식 훅: ${this.hook ? '있음' : '없음'} · 상태 줄: ${line}`,
    ];
  }
}

// cairn connect의 소식 단계 (2차 1-3, Claude Code만): 소식 기기(소식 읽기만) · 훅 · 상태 줄.
//   ~/.claude/settings.json    UserPromptSubmit 훅을 더하고(있던 훅은 그대로), 상태 줄이 없을 때만 건다
// 훅 · 상태 줄은 ~/.cairn/bin/cairn-news.mjs (기기 · 스크립트 · 열쇠 파일은 DeviceSetup).
export class NewsSetup extends DeviceSetup {
  private static readonly SCRIPT = 'cairn-news.mjs';
  private static readonly EVENT = 'UserPromptSubmit';
  /** Claude Code가 훅을 기다리는 시간(초). 스크립트는 2초 안에 스스로 끝낸다 */
  private static readonly HOOK_SECONDS = 5;
  protected readonly kind = DeviceKind.NEWS;
  protected readonly hooksLabel = '훅 · 상태 줄';

  private command(mode: 'hook' | 'status'): string {
    return `node "${this.home.script(NewsSetup.SCRIPT)}" ${mode}`;
  }

  protected attach(settings: Record<string, unknown>): boolean {
    const t = this.terminal;
    const hookAdded = this.settings.addHook(
      settings,
      NewsSetup.EVENT,
      NewsSetup.SCRIPT,
      this.command('hook'),
      NewsSetup.HOOK_SECONDS,
    );
    const statusLine = this.addStatusLine(settings);
    t.done(hookAdded ? '훅 · 말을 걸 때마다 팀 소식을 덧붙여요' : '훅 · 이미 있음');
    if (statusLine === 'other') {
      t.say(
        '상태 줄이 이미 있어 그대로 뒀어요. Cairn 소식을 함께 보려면 지금 상태 줄 명령에 이 출력을 더해요:',
      );
      t.say(`  ${this.command('status')}`);
    } else t.done(statusLine === 'added' ? '상태 줄 · Cairn · 진행 · 소식' : '상태 줄 · 이미 있음');
    return hookAdded || statusLine === 'added';
  }

  state(): NewsState {
    const settings = this.settings.read() ?? {};
    const line = settings.statusLine as { command?: unknown } | undefined;
    return new NewsState(
      this.saved(),
      this.settings.hasHook(settings, NewsSetup.EVENT, NewsSetup.SCRIPT),
      line === undefined
        ? 'none'
        : ClaudeSettings.ours(line.command, NewsSetup.SCRIPT)
          ? 'ours'
          : 'other',
    );
  }

  /** 상태 줄이 없으면 우리 것을 건다. 사용자의 것이면 건드리지 않는다 */
  private addStatusLine(settings: Record<string, unknown>): 'added' | 'kept' | 'other' {
    const line = settings.statusLine as { command?: unknown } | undefined;
    const command = this.command('status');
    if (line && !ClaudeSettings.ours(line.command, NewsSetup.SCRIPT)) return 'other';
    if (line?.command === command) return 'kept';
    settings.statusLine = { type: 'command', command, padding: 0 };
    return 'added';
  }
}
