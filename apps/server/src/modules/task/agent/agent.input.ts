import { BaseRequest } from '../../platform';

// 에이전트 입력의 모양. 뜻(도구 이름, 권한 목록)은 Agent가 검사한다.

const VERSION_MAX = 2_147_483_647;
const LIMIT_MAX = Number.MAX_SAFE_INTEGER;

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
        ),
    );
  }
}

/** PATCH /api/agents/:id. 보내지 않은 칸은 그대로, monthlyLimit에 null을 보내면 한도를 없앤다 */
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
