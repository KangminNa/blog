import { Conflict, RuleViolation } from '../platform';

// 그래프 안의 주소(slug): wiki · 카테고리 · 보관 파일 이름. 한글은 그대로 두고 빈칸·기호는 -로 바꾼다.
// 글 주소(blog)와 같은 규칙이지만 vault는 blog를 모르므로 따로 둔다. 휴지통에 있는 것의 주소도 그것의 것이다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 주소 규칙 한 곳. wiki·카테고리·보관 파일이 함께 쓴다
export class SlugPolicy {
  static readonly MAX = 80;
  private static readonly SHAPE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

  /** 제목에서 만든 주소 (예: "세션 저장 API!" → "세션-저장-api"). 글자가 없으면 빈 문자열 */
  static fromTitle(title: string): string {
    return title
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, SlugPolicy.MAX)
      .replace(/-+$/, '');
  }

  /** 사람이 정한 주소의 모양 */
  static check(slug: string): string {
    const s = slug.normalize('NFC').trim().toLowerCase();
    if (s.length > SlugPolicy.MAX || !SlugPolicy.SHAPE.test(s))
      throw new RuleViolation(`주소는 글자·숫자와 -로 ${SlugPolicy.MAX}자까지 써요`);
    return s;
  }

  /** 겹치지 않는 주소. 사람이 정한 주소가 겹치면 거절하고, 제목에서 만든 주소면 -2, -3 …을 붙인다 */
  static pick(wanted: string, taken: ReadonlySet<string>, manual: boolean): string {
    if (!taken.has(wanted)) return wanted;
    if (manual) throw new Conflict('이미 쓰는 주소예요 (휴지통 포함)');
    return SlugPolicy.numbered(wanted, taken);
  }

  /** 뒤에 번호를 붙여 겹치지 않게 (같은 날 같은 제목의 보관 파일도 이것으로) */
  static numbered(wanted: string, taken: ReadonlySet<string>): string {
    for (let n = 2; ; n++) {
      const suffix = `-${n}`;
      const candidate = `${wanted.slice(0, SlugPolicy.MAX - suffix.length)}${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
