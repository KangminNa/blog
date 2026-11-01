import { type BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { Database } from '../base/database';
import { ChangeSignal } from '../base/outbox';

// 변경 신호를 이 프로세스 안에서 나눠 준다. Postgres LISTEN 연결 하나를 듣고 받는 쪽(SSE, 긴 폴링)에 넘긴다.
// 듣기는 첫 받는 쪽이 생길 때 시작한다: 일꾼·명령줄은 듣지 않아 연결을 쓰지 않는다.
// 서버가 내려갈 때는 받는 쪽을 먼저 끝낸다 (열린 SSE가 있으면 HTTP 서버가 닫히지 않는다).
// 신호를 놓쳐도 내용은 테이블에 있으므로, 받는 쪽은 신호를 깨우기로만 쓴다.
@Injectable()
export class ChangeStream implements BeforeApplicationShutdown {
  private readonly receivers = new Set<(signal: ChangeSignal) => void>();
  private readonly closers = new Set<() => void>();
  private listening: Promise<unknown> | null = null;
  private closing = false;

  constructor(private readonly db: Database) {}

  /** 신호를 받는다. onClose는 서버가 내려갈 때 불린다. 돌려준 함수로 그만 받는다 */
  async subscribe(
    onSignal: (signal: ChangeSignal) => void,
    onClose: () => void,
  ): Promise<() => void> {
    await this.listen();
    this.receivers.add(onSignal);
    this.closers.add(onClose);
    return () => {
      this.receivers.delete(onSignal);
      this.closers.delete(onClose);
    };
  }

  /** 맞는 신호가 올 때까지 기다린다 (긴 폴링). 신호가 오면 true, 시간이 다 되거나 서버가 내려가면 false */
  async wait(matches: (signal: ChangeSignal) => boolean, ms: number): Promise<boolean> {
    if (this.closing) return false;
    let wake: (signalled: boolean) => void = () => {};
    const woken = new Promise<boolean>((resolve) => {
      wake = resolve;
    });
    const timer = setTimeout(() => wake(false), ms);
    const subscribing = this.subscribe(
      (signal) => {
        if (matches(signal)) wake(true);
      },
      () => wake(false),
    ).catch(() => null); // 듣지 못하면 시간이 다 될 때까지 기다린다. 부르는 쪽이 다시 조회한다
    const signalled = await woken;
    clearTimeout(timer);
    (await subscribing)?.(); // 구독이 끝나기 전에 시간이 다 됐어도 여기서 뺀다
    return signalled;
  }

  /** 서버가 내려가는 중인가. 긴 폴링은 더 기다리지 않고 돌아간다 */
  get closed(): boolean {
    return this.closing;
  }

  beforeApplicationShutdown(): void {
    this.closing = true;
    for (const close of [...this.closers]) close();
  }

  private listen(): Promise<unknown> {
    this.listening ??= this.db
      .listen(ChangeSignal.CHANNEL, (payload) => {
        const signal = ChangeSignal.parse(payload);
        for (const receive of [...this.receivers]) receive(signal);
      })
      .catch((error: unknown) => {
        this.listening = null;
        throw error;
      });
    return this.listening;
  }
}
