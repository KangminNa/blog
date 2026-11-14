// 러너의 자리 (CAIRN_RUNNER_CONCURRENCY): 동시에 도는 일을 세고, 자리가 빌 때까지 기다리게 한다.
// 일 하나는 다른 일과 상관없이 끝까지 간다 (JobRun · SigninRun이 각자 자리 · AI CLI · 보고를 가진다).
// 브라우저 작업은 자리가 남아도 하나씩만 한다: 서버 브라우저의 로그인된 프로필 하나를 AI 둘이 함께 움직이면 탭이 섞인다.
export class JobPool {
  private readonly running = new Set<Promise<void>>();
  private readonly browsing = new Set<Promise<void>>();

  constructor(readonly size: number) {}

  /** 지금 더 빌릴 수 있는 일의 수 */
  get free(): number {
    return Math.max(0, this.size - this.running.size);
  }

  /** 브라우저 작업이 도는 중인가 (그동안 next_jobs에 브라우저를 알리지 않는다) */
  get browserBusy(): boolean {
    return this.browsing.size > 0;
  }

  /** 일 하나를 자리에 앉힌다. 끝나면 저절로 자리가 빈다. work는 거절되지 않아야 한다 (실패는 부른 쪽이 미리 받는다) */
  add(work: Promise<void>, browse = false): void {
    this.running.add(work);
    if (browse) this.browsing.add(work);
    void work.finally(() => {
      this.running.delete(work);
      this.browsing.delete(work);
    });
  }

  /** 자리가 하나라도 빌 때까지 기다린다. stop이 오면 바로 돌아온다 */
  async vacancy(stop: AbortSignal): Promise<void> {
    while (this.free === 0 && !stop.aborted) {
      let leave = () => {};
      const stopped = new Promise<void>((done) => {
        leave = done;
        stop.addEventListener('abort', leave, { once: true });
      });
      await Promise.race([...this.running, stopped]);
      stop.removeEventListener('abort', leave);
    }
  }

  /** 도는 일이 모두 끝날 때까지 (멈출 때: 일마다 AI CLI를 끄고 돌려준다) */
  async drain(): Promise<void> {
    await Promise.all([...this.running]);
  }
}
