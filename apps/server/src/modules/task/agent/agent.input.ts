import { BaseRequest, type ColumnReaders, type RequestFields } from '../../platform';
import type { AgentRow } from '../task.tables';

// 에이전트 입력의 모양. 뜻(도구 이름, 권한 목록)은 Agent가 검사한다.

const LIMIT_MAX = Number.MAX_SAFE_INTEGER;

/** 주인이 정하는 칸. 칸 하나에 한 줄이다. 보내지 않은 칸은 그대로, 한도에 null을 보내면 한도를 없앤다 */
const COLUMNS: ColumnReaders<AgentRow> = {
  name: (f, n) => f.optionalText(n, 200) ?? undefined,
  role: (f, n) => f.optionalText(n, 4000) ?? '',
  tool: (f, n) => f.optionalText(n, 40) ?? undefined,
  scopes: (f, n) => f.optionalTextList(n, 20, 40) ?? undefined,
  approval_actions: (f, n) => f.optionalTextList(n, 20, 100) ?? undefined,
  monthly_limit: (f, n) => f.optionalInteger(n, 1, LIMIT_MAX),
  five_hour_limit: (f, n) => f.optionalInteger(n, 1, LIMIT_MAX),
  plan_stop_percent: (f, n) => f.optionalInteger(n, 1, 100),
};

/** 보고 대상 칸 (만들기 · 고치기가 함께 쓴다): 보내지 않으면 undefined, null이면 주인에게 보고 */
function reportsToOf(f: RequestFields, raw: unknown): string | null | undefined {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (!('reportsTo' in body)) return undefined;
  return body.reportsTo === null ? null : f.uuid('reportsTo');
}

/** 일을 맡을 러너 칸 (만들기 · 고치기가 함께 쓴다): 보내지 않으면 undefined, null이면 아무 러너 */
function runnerOf(f: RequestFields, raw: unknown): string | null | undefined {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (!('runnerId' in body)) return undefined;
  return body.runnerId === null ? null : f.uuid('runnerId');
}

/** 검토자 짝: 칸이 없으면 그대로(undefined), null이면 뺀다 (2차 2단계) */
function reviewerOf(f: RequestFields, raw: unknown): string | null | undefined {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (!('reviewerId' in body)) return undefined;
  return body.reviewerId === null ? null : f.uuid('reviewerId');
}

/** POST /api/agents. 같은 requestId는 처음 만든 에이전트를 돌려준다 */
export class CreateAgentInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly fields: Partial<AgentRow>,
    /** 보고 대상. 없으면 주인에게 보고한다 */
    readonly reportsTo: string | null,
    /** 일을 맡을 러너 (task.runners의 id). 없으면 아무 러너 */
    readonly runnerId: string | null,
  ) {
    super();
  }

  /** 이름과 도구는 꼭 있어야 한다. 앞의 세 칸을 먼저 읽어 틀린 칸이 칸 순서대로 모인다 */
  static from(raw: unknown): CreateAgentInput {
    return BaseRequest.read(raw, (f) => {
      const requestId = f.uuid('requestId');
      const name = f.text('name', 200);
      const role = f.optionalText('role', 4000) ?? '';
      const tool = f.text('tool', 40);
      const fields = { ...f.columns(COLUMNS), name, role, tool };
      return new CreateAgentInput(
        requestId,
        fields,
        reportsToOf(f, raw) ?? null,
        runnerOf(f, raw) ?? null,
      );
    });
  }
}

/** POST /api/agent-teams: 템플릿(team)으로 팀 하나. tool은 모든 구성원의 AI 도구 (기본 claude) */
export class CreateAgentTeamInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly team: string,
    readonly tool: string,
  ) {
    super();
  }

  static from(raw: unknown): CreateAgentTeamInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new CreateAgentTeamInput(
          f.uuid('requestId'),
          f.text('team', 40),
          f.optionalText('tool', 40) ?? 'claude',
        ),
    );
  }
}

/** GET /api/agents?deleted=1: 휴지통의 에이전트만 */
export class ListAgentsInput extends BaseRequest {
  private constructor(readonly deleted: boolean) {
    super();
  }

  static from(raw: unknown): ListAgentsInput {
    return new ListAgentsInput((raw as Record<string, unknown> | null)?.deleted === '1');
  }
}

/** POST /api/agents/:id/delete { version, team? }: team이면 아래 팀 전체를 함께, 아니면 팀원을 위로 올린다 */
export class DeleteAgentInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly team: boolean,
  ) {
    super();
  }

  static from(id: string, raw: unknown): DeleteAgentInput {
    const body = { ...(raw as object), id } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) =>
        new DeleteAgentInput(
          f.uuid('id'),
          f.version(),
          body.team === undefined ? false : f.boolean('team'),
        ),
    );
  }
}

/** PATCH /api/agents/:id. reportsTo에 null이면 주인에게 보고, runnerId에 null이면 아무 러너, reviewerId에 null이면 검토자 없음 */
export class UpdateAgentInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly changes: Partial<AgentRow>,
    readonly reportsTo: string | null | undefined,
    readonly runnerId: string | null | undefined,
    readonly reviewerId: string | null | undefined,
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
          f.version(),
          f.columns(COLUMNS),
          reportsToOf(f, body),
          runnerOf(f, body),
          reviewerOf(f, body),
        ),
    );
  }
}
