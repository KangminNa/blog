import type { CairnServer } from './cairn-server';
import { ProgressBatch, type ProgressState, type RunEvent } from './progress';
import type { Redactor } from './redactor';

// 실행 기록을 모아 report_progress로 보낸다. 한 번에 한 묶음만 보내고,
// 보내지 못한 묶음은 같은 모양과 request_id로 다시 보낸다. 새 기록은 다음 묶음으로 간다.
export class ProgressReporter {
  /** 서버의 ReportProgressInput.EVENTS_MAX */
  private static readonly EVENTS_MAX = 100;
  /** 서버의 본문 한도는 512KB. 글자를 이스케이프해도 넘지 않게 절반에서 끊는다 */
  private static readonly BYTES_MAX = 256 * 1024;
  private queue: RunEvent[] = [];
  private unsent: ProgressBatch | null = null;
  private lease: Date | null;

  constructor(
    private readonly server: CairnServer,
    private readonly taskId: string,
    private readonly redactor: Redactor,
    leaseUntil: Date | null,
  ) {
    this.lease = leaseUntil;
  }

  add(events: readonly RunEvent[]): void {
    this.queue.push(...events.map((event) => event.prepared(this.redactor)));
  }

  /** 보낼 것이 남지 않았는가 */
  get idle(): boolean {
    return this.queue.length === 0 && this.unsent === null;
  }

  /** 임대가 끝났는가. 응답을 받지 못하는 동안에도 끝나는 시각은 안다 */
  get leaseOver(): boolean {
    return this.lease !== null && this.lease.getTime() <= Date.now();
  }

  /** 한 묶음을 보낸다. 기록이 없으면 빈 보고로 임대를 늘린다. 실패하면 묶음을 들고 있다가 다음에 다시 보낸다 */
  async send(): Promise<ProgressState> {
    const batch = this.unsent ?? this.nextBatch();
    this.unsent = batch;
    const state = await this.server.report(this.taskId, batch);
    this.unsent = null;
    this.lease = state.leaseUntil ?? this.lease;
    return state;
  }

  private nextBatch(): ProgressBatch {
    let bytes = 0;
    let count = 0;
    while (count < this.queue.length && count < ProgressReporter.EVENTS_MAX) {
      bytes += Buffer.byteLength(JSON.stringify(this.queue[count]));
      if (bytes > ProgressReporter.BYTES_MAX) break;
      count += 1;
    }
    return ProgressBatch.of(this.queue.splice(0, count));
  }
}
