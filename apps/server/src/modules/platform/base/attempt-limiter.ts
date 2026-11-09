import { isIPv4, isIPv6 } from 'node:net';
import { TooManyRequests } from './errors';

// 한 곳(IP)이나 한 아이디에서 짧은 시간에 너무 많이 시도하는 것을 막는다 (설치 코드·비밀번호 찔러보기).
// 서버 메모리에만 두므로 서버를 다시 켜면 비워진다. 서버가 하나인 지금은 이것으로 충분하다.
//   hit: 시도마다 센다 (설치 코드)
//   check + fail: 틀린 시도만 센다 (로그인: 맞게 여러 번 로그인하는 건 막지 않는다)
// IP로 셀 때는 place(ip)로 센다: IPv6는 한 집이 /64를 통째로 받아 주소를 바꿔 가며 셀 수를 피할 수 있다.
export class AttemptLimiter {
  /** IPv6에서 한 곳으로 보는 앞부분 (16비트 묶음 4개 = /64) */
  private static readonly V6_GROUPS = 4;
  private readonly attempts = new Map<string, number[]>();

  /**
   * IP를 "한 곳"의 열쇠로: IPv4는 그대로, IPv4를 담은 IPv6(::ffff:1.2.3.4)는 IPv4로, IPv6는 /64로 묶는다.
   * IP 모양이 아니면 그대로 둔다 (다른 열쇠와 섞이지 않게 앞에 붙는 것이 없다)
   */
  static place(ip: string): string {
    const address = ip.split('%')[0] ?? ip;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
    if (mapped?.[1] && isIPv4(mapped[1])) return mapped[1];
    if (!isIPv6(address)) return ip;
    const [head = '', tail] = address.split('::');
    const left = head ? head.split(':') : [];
    const right = tail === undefined ? [] : tail ? tail.split(':') : [];
    const groups =
      tail === undefined
        ? left
        : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
    const prefix = groups
      .slice(0, AttemptLimiter.V6_GROUPS)
      .map((g) => Number.parseInt(g, 16).toString(16));
    return `${prefix.join(':')}::/64`;
  }

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
