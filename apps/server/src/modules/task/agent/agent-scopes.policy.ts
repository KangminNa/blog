import { Actor, RuleViolation } from '../../platform';

// 에이전트에게 줄 수 있는 권한과 함께 줄 수 없는 조합 (Agent의 scopes 규칙). DB CHECK와 같다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Agent의 규칙과 러너 묶기가 함께 쓴다
export class AgentScopes {
  /** 에이전트에게 줄 수 있는 권한. run은 러너의 것이라 없다: 에이전트가 스스로 일을 빌릴 수 없게 */
  static readonly ALL: readonly string[] = [
    Actor.UPLOAD,
    Actor.READ_PUBLIC,
    Actor.READ_ALL,
    Actor.TIDY,
    Actor.WRITE,
    Actor.BROWSE,
    Actor.CODE,
    Actor.MAKE,
  ];
  /** browse와 함께 줄 수 없는 권한: 비공개(세션 · wiki)와 임시 글 · 소재를 여는 것. DB CHECK agents_browse_not_private와 같다 */
  private static readonly NOT_WITH_BROWSE: readonly string[] = [Actor.READ_ALL, Actor.WRITE];
  /**
   * 셸이 있는 칸에서 도는 일(code · make)과 함께 줄 수 없는 권한: 비공개 지식과 셸을 한 에이전트에 모으지 않는다.
   * DB CHECK agents_code_not_private · agents_make_not_private와 같다
   */
  private static readonly NOT_WITH_SHELL: readonly string[] = [Actor.READ_ALL, Actor.WRITE];
  /** 코드 러너 칸에서만 도는 일의 권한 (Task.SANDBOXED의 일). 이런 에이전트는 러너에 묶지 않는다 */
  private static readonly SANDBOXED: readonly string[] = [Actor.CODE, Actor.MAKE];

  /** 들어온 권한 목록을 검사하고 정한 순서로 돌려준다 */
  static check(value: readonly string[]): string[] {
    const unknown = value.filter((s) => !AgentScopes.ALL.includes(s));
    if (unknown.length > 0)
      throw new RuleViolation(`에이전트에게 줄 수 없는 권한이에요: ${unknown.join(', ')}`);
    // 로그인된 브라우저 + 비공개 + 밖으로 보내기가 한 에이전트에 모이지 않게 (브라우저 작업은 비공개를 못 읽는다).
    // write도 임시 글 본문과 소재 메모를 연다 (blog_get_post · basket_get). 재료는 지시문으로 받는다
    if (value.includes(Actor.BROWSE) && AgentScopes.NOT_WITH_BROWSE.some((s) => value.includes(s)))
      throw new RuleViolation(
        '브라우저 사용은 전체 읽기 · 초안 작성과 함께 줄 수 없어요 (browse · read_all · write)',
      );
    // 셸이 있는 칸 + 비공개가 한 에이전트에 모이지 않게: 저장소 파일에 심은 지시문에 속아도 비공개를 내보내지 못한다
    if (value.includes(Actor.CODE) && AgentScopes.NOT_WITH_SHELL.some((s) => value.includes(s)))
      throw new RuleViolation(
        '코드 작업은 전체 읽기 · 초안 작성과 함께 줄 수 없어요 (code · read_all · write)',
      );
    // 만들기도 칸의 셸로 한다. 비공개는 주인이 작업마다 고른 재료만 읽는다 (MakeMaterials)
    if (value.includes(Actor.MAKE) && AgentScopes.NOT_WITH_SHELL.some((s) => value.includes(s)))
      throw new RuleViolation(
        '파일 만들기는 전체 읽기 · 초안 작성과 함께 줄 수 없어요 (make · read_all · write)',
      );
    return AgentScopes.ALL.filter((s) => value.includes(s));
  }

  /** 코드 러너 칸에서만 도는 권한(code · make)이 있는가. DB CHECK agents_pinned_not_sandboxed와 같다 */
  static sandboxed(scopes: readonly string[]): boolean {
    return scopes.some((s) => AgentScopes.SANDBOXED.includes(s));
  }
}
