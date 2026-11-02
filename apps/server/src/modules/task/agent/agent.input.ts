import { BaseRequest, type ColumnReaders } from '../../platform';
import type { AgentRow } from '../task.tables';

// 에이전트 입력의 모양. 뜻(도구 이름, 권한 목록)은 Agent가 검사한다.

const LIMIT_MAX = Number.MAX_SAFE_INTEGER;

/** 주인이 정하는 칸. 칸 하나에 한 줄이다 */
const AGENT_COLUMNS: ColumnReaders<AgentRow> = {
  name: (f, n) => f.optionalText(n, 200) ?? undefined,
  role: (f, n) => f.optionalText(n, 4000) ?? '',
  tool: (f, n) => f.optionalText(n, 40) ?? undefined,
  scopes: (f, n) => f.optionalTextList(n, 20, 40) ?? undefined,
  approval_actions: (f, n) => f.optionalTextList(n, 20, 100) ?? undefined,
  monthly_limit: (f, n) => f.optionalInteger(n, 1, LIMIT_MAX),
  five_hour_limit: (f, n) => f.optionalInteger(n, 1, LIMIT_MAX),
  plan_stop_percent: (f, n) => f.optionalInteger(n, 1, 100),
};

/** POST /api/agents. 같은 requestId는 처음 만든 에이전트를 돌려준다 */
export class CreateAgentInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly fields: Partial<AgentRow>,
  ) {
    super();
  }

  static from(raw: unknown): CreateAgentInput {
    return BaseRequest.read(
      raw,
      (f) => new CreateAgentInput(f.uuid('requestId'), f.columns(AGENT_COLUMNS, ['name', 'tool'])),
    );
  }
}

/** PATCH /api/agents/:id. 보내지 않은 칸은 그대로, 한도에 null을 보내면 한도를 없앤다 */
export class UpdateAgentInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly changes: Partial<AgentRow>,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateAgentInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) => new UpdateAgentInput(f.uuid('id'), f.version(), f.columns(AGENT_COLUMNS)),
    );
  }
}
