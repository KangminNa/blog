import { DeviceKind } from './device-login';
import { DeviceSetup, DeviceState } from './device-setup';

/** 이 컴퓨터의 세션 저장 상태 (cairn status) */
export class CollectState extends DeviceState {
  constructor(
    saved: Record<string, unknown> | undefined,
    readonly hook: boolean,
    /** 마지막으로 세션을 올린 때 */
    readonly lastSaved: Date | null,
    /** 아직 올리지 못한 세션 수 (~/.cairn/outbox) */
    readonly waiting: number,
  ) {
    super(saved);
  }

  get lines(): string[] {
    const last = this.lastSaved ? CollectState.when(this.lastSaved) : '없음';
    const waiting = this.waiting ? `${this.waiting}개 (다음 세션이 끝날 때 다시 올려요)` : '없음';
    return [
      this.deviceLine(DeviceKind.COLLECT),
      `  세션 저장 훅: ${this.hook ? '있음' : '없음'} · 마지막 저장: ${last} · 못 올린 세션: ${waiting}`,
    ];
  }

  /** 이 컴퓨터의 시각으로 2026-11-14 19:03 */
  private static when(at: Date): string {
    const two = (n: number) => String(n).padStart(2, '0');
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
  }
}

// cairn connect의 세션 저장 단계 (2차 4, Claude Code만): 세션 저장 기기(세션 올리기만, 권한 upload) · SessionEnd 훅.
//   ~/.claude/settings.json    SessionEnd 훅을 더한다 (있던 훅은 그대로)
// 훅(~/.cairn/bin/cairn-collect.mjs)은 일꾼을 떼어 띄우고 곧바로 끝난다. 일꾼이 그 세션을 글로 바꿔 블로그에 올린다.
// 저장소마다 끄려면 저장소 맨 위의 .cairn.json에 "collect": false.
export class CollectSetup extends DeviceSetup {
  private static readonly SCRIPT = 'cairn-collect.mjs';
  private static readonly EVENT = 'SessionEnd';
  /** Claude Code가 훅을 기다리는 시간(초). 훅은 일꾼만 띄우고 1초 안에 끝낸다 */
  private static readonly HOOK_SECONDS = 5;
  protected readonly kind = DeviceKind.COLLECT;
  protected readonly hooksLabel = '세션 저장 훅';

  protected attach(settings: Record<string, unknown>): boolean {
    const added = this.settings.addHook(
      settings,
      CollectSetup.EVENT,
      CollectSetup.SCRIPT,
      `node "${this.home.script(CollectSetup.SCRIPT)}" hook`,
      CollectSetup.HOOK_SECONDS,
    );
    if (!added) {
      this.terminal.done('세션 저장 훅 · 이미 있음');
      return false;
    }
    this.terminal.done('세션 저장 훅 · Claude Code 세션이 끝나면 블로그에 올려요');
    this.terminal.say('  저장소마다 끄려면 저장소 맨 위의 .cairn.json에 {"collect": false}');
    return true;
  }

  state(): CollectState {
    const settings = this.settings.read() ?? {};
    return new CollectState(
      this.saved(),
      this.settings.hasHook(settings, CollectSetup.EVENT, CollectSetup.SCRIPT),
      this.home.lastSaved(),
      this.home.outboxCount(),
    );
  }
}
