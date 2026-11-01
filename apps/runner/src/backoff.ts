/** ms만큼 기다린다. stop이 오면 바로 돌아온다 */
export function pause(ms: number, stop?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (stop?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      stop?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    stop?.addEventListener('abort', done, { once: true });
  });
}

/** 실패가 이어질수록 길게 기다린다. 성공하면 reset으로 처음부터 */
export class Backoff {
  private delay: number;

  constructor(
    private readonly first: number,
    private readonly max: number,
  ) {
    this.delay = first;
  }

  reset(): void {
    this.delay = this.first;
  }

  async wait(stop?: AbortSignal): Promise<void> {
    await pause(this.delay, stop);
    this.delay = Math.min(this.delay * 2, this.max);
  }
}
