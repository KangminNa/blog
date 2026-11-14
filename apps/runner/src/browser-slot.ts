// 서버 브라우저의 로그인된 프로필(기본 컨텍스트)을 쓰는 자리 하나 (2차 3단계, 2026-11-14).
// 사이트 일(AI가 사이트에서 채우기)과 결재된 클릭(러너가 누르기)은 한 번에 하나만 한다: 같은 프로필의 탭을 둘이 함께 움직이면
// Playwright MCP가 붙을 때 고르는 탭이 섞이고, 누르는 동안 다른 일이 그 페이지를 옮길 수 있다.
// 둘러보기는 일마다 새 빈 컨텍스트라 자리를 쓰지 않고 여럿이 함께 돈다. 차례대로 받는다 (먼저 기다린 쪽이 먼저)
export class BrowserSlot {
  private tail: Promise<void> = Promise.resolve();

  /** 자리가 날 때까지 기다렸다 잡는다. 놓는 함수를 돌려준다 (두 번 불러도 한 번). 기다리다 stop이 오면 null */
  async take(stop: AbortSignal): Promise<(() => void) | null> {
    let free = () => {};
    const mine = new Promise<void>((done) => {
      free = done;
    });
    const before = this.tail;
    this.tail = before.then(() => mine);
    let leave = () => {};
    const stopped = new Promise<void>((done) => {
      leave = () => done();
      if (stop.aborted) done();
      else stop.addEventListener('abort', leave, { once: true });
    });
    await Promise.race([before, stopped]);
    stop.removeEventListener('abort', leave);
    if (stop.aborted) {
      // 줄은 이어야 한다: 앞이 놓으면 바로 이 자리도 놓는다
      void before.then(free);
      return null;
    }
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      free();
    };
  }
}
