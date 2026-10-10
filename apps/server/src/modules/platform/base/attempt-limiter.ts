import { TooManyRequests } from './errors';

// 한 곳(IP)이나 한 아이디에서 짧은 시간에 너무 많이 시도하는 것을 막는다 (설치 코드·비밀번호 찔러보기).
// 서버 메모리에만 두므로 서버를 다시 켜면 비워진다. 서버가 하나인 지금은 이것으로 충분하다.
//   hit: 시도마다 센다 (설치 코드)
//   check + fail: 틀린 시도만 센다 (로그인: 맞게 여러 번 로그인하는 건 막지 않는다)
export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** 시도 하나를 센다. 창 안에서 max번을 넘으면 TooManyRequests */
  hit(key: string, now: number = Date.now()): void {
    this.check(key, now);
    this.fail(key, now);
  }

  /** 지금 시도해도 되는가. 창 안에서 이미 max번 셌으면 TooManyRequests */
  check(key: string, now: number = Date.now()): void {
    const recent = this.recent(key, now);
    if (recent.length < this.max) return;
    const waitSeconds = Math.ceil((this.windowMs - (now - (recent[0] ?? now))) / 1000);
    throw new TooManyRequests(`너무 많이 시도했어요. ${waitSeconds}초 뒤에 다시 해 주세요`);
  }

  /** 틀린 시도 하나를 센다 */
  fail(key: string, now: number = Date.now()): void {
    this.attempts.set(key, [...this.recent(key, now), now]);
  }

  private recent(key: string, now: number): number[] {
    return (this.attempts.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }
}
