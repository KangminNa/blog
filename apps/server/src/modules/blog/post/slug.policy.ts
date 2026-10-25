import { RuleViolation } from '../../platform';

// 글 주소(slug). 한글은 그대로 두고 빈칸·기호는 -로 바꾼다 (2026-10-10 결정: 한글 주소 허용).
// 같은 공간 안에서 겹치지 않는다. 휴지통 글의 주소도 영구 삭제 전까지는 그 글의 것이다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 주소 규칙 한 곳. 새 글·고쳐 쓰기·요청 검사가 함께 쓴다
export class SlugPolicy {
  static readonly MAX = 80;
  private static readonly SHAPE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

  /** 원하는 주소: 사람이 정했으면 그 모양을 보고, 아니면 제목에서 만든다 */
  static wanted(requested: string | null, title: string): string {
    return requested === null ? SlugPolicy.fromTitle(title) : SlugPolicy.check(requested);
  }

  /** 제목에서 만든 주소 (예: "세션 저장 API!" → "세션-저장-api") */
  static fromTitle(title: string): string {
    const slug = title
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, SlugPolicy.MAX)
      .replace(/-+$/, '');
    return slug || 'post';
  }

  /** 사람이 정한 주소의 모양 */
  static check(slug: string): string {
    const s = slug.normalize('NFC').trim().toLowerCase();
    if (s.length > SlugPolicy.MAX || !SlugPolicy.SHAPE.test(s))
      throw new RuleViolation(`주소는 글자·숫자와 -로 ${SlugPolicy.MAX}자까지 써요`);
    return s;
  }

  /**
   * 겹치지 않는 주소. taken: 이 주소이거나 "이 주소-숫자"인 다른 글의 주소들.
   * 사람이 정한 주소가 겹치면 거절하고, 제목에서 만든 주소면 -2, -3 …을 붙인다
   */
  static pick(wanted: string, taken: ReadonlySet<string>, manual: boolean): string {
    if (!taken.has(wanted)) return wanted;
    if (manual) throw new RuleViolation('이미 쓰는 주소예요 (휴지통 글 포함)');
    for (let n = 2; ; n++) {
      const suffix = `-${n}`;
      const candidate = `${wanted.slice(0, SlugPolicy.MAX - suffix.length)}${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
