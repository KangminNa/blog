import { Forbidden, RuleViolation } from '../../platform';

// 만들기 작업(make)의 재료: 주인이 고른 결과물 파일과 위키 (payload.make, 기획서 결정 2026-11-11).
// 결과물은 러너가 begin_download로 받아 작업 자리의 inputs/에 두고, 위키는 작업 토큰에 읽기 허락으로 봉인해
// get_wiki로만 읽는다 (Actor.mayRead). make 에이전트는 read_all을 가질 수 없으므로 고르지 않은 비공개는 읽지 못한다:
// 셸이 있는 칸은 허용한 호스트로 나갈 수 있어서, 재료에 심은 지시문에 속아도 내보낼 수 있는 것을 고른 재료로 좁힌다.
export class MakeMaterials {
  /** 결과물 · 위키 각각 */
  static readonly MAX = 10;
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  private constructor(
    /** 재료 결과물의 id. 러너가 파일로 받는다 */
    readonly outputs: readonly string[],
    /** 재료 위키의 id. 작업 토큰에 읽기 허락으로 봉인한다 */
    readonly wikis: readonly string[],
  ) {}

  /** payload의 make에서. 없으면 재료 없음, 모양이 틀리면 RuleViolation */
  static of(payload: unknown): MakeMaterials {
    const make = (payload as { make?: unknown } | null)?.make;
    if (make === undefined || make === null) return new MakeMaterials([], []);
    if (typeof make !== 'object' || Array.isArray(make))
      throw new RuleViolation('재료(make)는 outputs · wikis를 담은 객체예요');
    const { outputs = [], wikis = [] } = make as { outputs?: unknown; wikis?: unknown };
    return new MakeMaterials(
      MakeMaterials.ids('결과물', outputs),
      MakeMaterials.ids('위키', wikis),
    );
  }

  /** 재료를 적었는가 (make가 아닌 일에는 적지 않는다) */
  static given(payload: unknown): boolean {
    const make = (payload as { make?: unknown } | null)?.make;
    return make !== undefined && make !== null;
  }

  /** 맡길 때: 고른 결과물이 공간에 있고 휴지통에 없어야 한다 (live: 그중 살아 있는 id) */
  assertLive(live: readonly string[]): void {
    const missing = this.outputs.filter((id) => !live.includes(id));
    if (missing.length > 0)
      throw new RuleViolation(`없거나 휴지통에 있는 결과물이에요: ${missing.join(', ')}`);
  }

  /** 러너가 받으려는 결과물이 이 작업의 재료인가 (begin_download) */
  assertOutput(id: string): void {
    if (!this.outputs.includes(id))
      throw new Forbidden('make', '이 작업의 재료가 아닌 결과물이에요');
  }

  private static ids(label: string, raw: unknown): string[] {
    if (
      !Array.isArray(raw) ||
      raw.some((v) => typeof v !== 'string' || !MakeMaterials.UUID.test(v))
    )
      throw new RuleViolation(`${label} 재료는 id 목록이에요`);
    const unique = [...new Set(raw as string[])];
    if (unique.length > MakeMaterials.MAX)
      throw new RuleViolation(`${label} 재료는 ${MakeMaterials.MAX}개까지예요`);
    return unique;
  }
}
