import { BaseRequest, type RequestFields } from '../../platform';

// 에이전트 입력의 모양. 뜻(도구 이름, 권한 목록)은 Agent가 검사한다.

const VERSION_MAX = 2_147_483_647;
const LIMIT_MAX = Number.MAX_SAFE_INTEGER;
const PLAN_PERCENT_MAX = 100;

/** POST /api/agents. 같은 requestId는 처음 만든 에이전트를 돌려준다 */
export class CreateAgentInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly name: string,
    readonly role: string,
    readonly tool: string,
    readonly scopes: readonly string[],
    readonly approvalActions: readonly string[],
    readonly monthlyLimit: number | null,
    readonly fiveHourLimit: number | null,
    readonly planStopPercent: number | null,
    /** 보고 대상. 없으면 주인에게 보고한다 */
    readonly reportsTo: string | null,
  ) {
    super();
  }

  static from(raw: unknown): CreateAgentInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new CreateAgentInput(
          f.uuid('requestId'),
          f.text('name', 200),
          f.optionalText('role', 4000) ?? '',
          f.text('tool', 40),
          f.optionalTextList('scopes', 20, 40) ?? [],
          f.optionalTextList('approvalActions', 20, 100) ?? [],
          f.optionalInteger('monthlyLimit', 1, LIMIT_MAX),
          f.optionalInteger('fiveHourLimit', 1, LIMIT_MAX),
          f.optionalInteger('planStopPercent', 1, PLAN_PERCENT_MAX),
          CreateAgentInput.reportsToOf(f, raw) ?? null,
        ),
    );
  }

  /** 보고 대상 칸 (만들기 · 고치기가 함께 쓴다): 보내지 않으면 undefined, null이면 주인에게 보고 */
  static reportsToOf(f: RequestFields, raw: unknown): string | null | undefined {
    const body = (raw ?? {}) as Record<string, unknown>;
    if (!('reportsTo' in body)) return undefined;
    return body.reportsTo === null ? null : f.uuid('reportsTo');
  }
}

/** PATCH /api/agents/:id. 보내지 않은 칸은 그대로, 한도에 null을 보내면 한도를 없앤다. reportsTo에 null이면 주인에게 보고 */
export class UpdateAgentInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly name: string | null,
    readonly role: string | undefined,
    readonly tool: string | null,
    readonly scopes: readonly string[] | null,
    readonly approvalActions: readonly string[] | null,
    readonly monthlyLimit: number | null | undefined,
    readonly fiveHourLimit: number | null | undefined,
    readonly planStopPercent: number | null | undefined,
    readonly reportsTo: string | null | undefined,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateAgentInput {
    const body = { ...(raw as object), id };
    return BaseRequest.read(
      body,
      (f) =>
        new UpdateAgentInput(
          f.uuid('id'),
          f.integer('version', 1, VERSION_MAX),
          f.optionalText('name', 200),
          'role' in body ? (f.optionalText('role', 4000) ?? '') : undefined,
          f.optionalText('tool', 40),
          f.optionalTextList('scopes', 20, 40),
          f.optionalTextList('approvalActions', 20, 100),
          'monthlyLimit' in body ? f.optionalInteger('monthlyLimit', 1, LIMIT_MAX) : undefined,
          'fiveHourLimit' in body ? f.optionalInteger('fiveHourLimit', 1, LIMIT_MAX) : undefined,
          'planStopPercent' in body
            ? f.optionalInteger('planStopPercent', 1, PLAN_PERCENT_MAX)
            : undefined,
          CreateAgentInput.reportsToOf(f, body),
        ),
    );
  }
}

/** 멈추기·다시 시작: 화면이 본 버전과 함께 */
export class AgentVersionInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }

  static from(id: string, raw: unknown): AgentVersionInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) => new AgentVersionInput(f.uuid('id'), f.integer('version', 1, VERSION_MAX)),
    );
  }
}
