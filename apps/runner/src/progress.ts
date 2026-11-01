import { randomUUID } from 'node:crypto';
import type { Json } from './json';
import type { Redactor } from './redactor';

/** 실행 기록 한 줄 (task.task_events). 종류는 read · write · result · error */
export class RunEvent {
  static readonly READ = 'read';
  static readonly WRITE = 'write';
  static readonly RESULT = 'result';
  static readonly ERROR = 'error';
  /** 한 줄의 길이. 한 번의 보고가 서버의 본문 한도(512KB)를 넘지 않게 짧게 둔다 */
  private static readonly BODY_MAX = 2_000;

  constructor(
    readonly kind: string,
    readonly body: string,
    readonly tokens: number,
  ) {}

  /** 서버로 보낼 모양. 토큰을 먼저 지우고 자른다: 자른 뒤에는 토큰 일부가 남을 수 있다 */
  prepared(redactor: Redactor): RunEvent {
    return new RunEvent(
      this.kind,
      Clip.text(redactor.clean(this.body), RunEvent.BODY_MAX),
      this.tokens,
    );
  }

  /** report_progress의 events 항목 */
  toJSON(): object {
    return { kind: this.kind, body: this.body, tokens: this.tokens };
  }
}

// biome-ignore lint/complexity/noStaticOnlyClass: 서버로 보내는 글을 같은 규칙으로 자르는 한 곳
export class Clip {
  /** 길이를 줄이고 Postgres가 받지 못하는 NUL을 뺀다 */
  static text(text: string, max: number): string {
    const clean = text.replaceAll('\u0000', '');
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  }
}

/**
 * 한 번의 보고. requestId는 묶음을 만들 때 정하고 다시 보낼 때 그대로 쓴다.
 * 보내고 응답만 잃었을 수 있어서, 같은 id여야 서버가 토큰을 두 번 세지 않는다. 빈 보고에는 없다.
 */
export class ProgressBatch {
  private constructor(
    readonly requestId: string | null,
    readonly events: readonly RunEvent[],
  ) {}

  static of(events: readonly RunEvent[]): ProgressBatch {
    return new ProgressBatch(events.length === 0 ? null : randomUUID(), events);
  }
}

/** report_progress의 답 */
export class ProgressState {
  static readonly RUNNING = 'running';
  static readonly WAITING = 'waiting';

  constructor(
    readonly status: string,
    readonly cancelled: boolean,
    readonly paused: boolean,
    readonly leaseUntil: Date | null,
  ) {}

  static from(raw: Json): ProgressState {
    const lease = raw.optionalText('lease_until');
    return new ProgressState(
      raw.text('status'),
      raw.flag('cancelled'),
      raw.flag('paused'),
      lease === null ? null : new Date(lease),
    );
  }
}

/** 실행의 끝을 서버에 알리는 한 번 (submit_result). requestId는 다시 보내도 같다 */
export class RunResult {
  /** 결과 글의 길이. 서버의 본문 한도(512KB) 안에 들어가게 둔다 */
  private static readonly TEXT_MAX = 60_000;
  /** 서버가 받는 error 길이는 4000자지만 짧게 적는다 */
  private static readonly ERROR_MAX = 1_000;
  readonly requestId = randomUUID();

  private constructor(
    readonly status: string,
    readonly text: string | null,
    readonly error: string | null,
  ) {}

  static done(text: string, redactor: Redactor): RunResult {
    return new RunResult('done', Clip.text(redactor.clean(text), RunResult.TEXT_MAX), null);
  }

  static failed(error: string, redactor: Redactor): RunResult {
    return new RunResult('failed', null, Clip.text(redactor.clean(error), RunResult.ERROR_MAX));
  }
}
