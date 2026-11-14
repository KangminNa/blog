import { BaseRequest, type RequestFields } from '../../platform';
import type { GoalRoundRow, GoalRunRow } from '../task.tables';
import { GoalRound } from './goal-round';
import { GoalRun } from './goal-run';

// 목표 실행 입력의 모양. 뜻(목표 진행 중, 팀장, 결재 시점, 한도)은 GoalRun · GoalRound가 검사한다.

/** POST /api/goal-runs. 같은 requestId가 다시 오면 처음 만든 실행 */
export class CreateGoalRunInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly goalId: string,
    readonly agentId: string,
    readonly fields: Partial<GoalRunRow>,
  ) {
    super();
  }

  static from(raw: unknown): CreateGoalRunInput {
    const body = { ...(raw as object) } as Record<string, unknown>;
    return BaseRequest.read(body, (f) => {
      const title = f.optionalText('title', GoalRun.TITLE_MAX);
      return new CreateGoalRunInput(f.text('requestId', 200), f.uuid('goalId'), f.uuid('agentId'), {
        ...(title ? { title } : {}),
        instruction: f.text('instruction', GoalRun.INSTRUCTION_MAX),
        criteria: f.optionalTextList('criteria', GoalRun.CRITERIA_MAX, GoalRun.CRITERION_MAX) ?? [],
        checkpoint: f.optionalText('checkpoint', 20) ?? GoalRun.MILESTONE,
        max_rounds: f.optionalInteger('maxRounds', 1, GoalRun.ROUNDS_LIMIT) ?? 5,
      });
    });
  }
}

/** GET /api/goal-runs/:id */
export class GoalRunIdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): GoalRunIdInput {
    return BaseRequest.read({ id }, (f) => new GoalRunIdInput(f.uuid('id')));
  }
}

/** GET /api/goal-runs?goalId= */
export class ListGoalRunsInput extends BaseRequest {
  private constructor(readonly goalId: string | null) {
    super();
  }

  static from(query: unknown): ListGoalRunsInput {
    const body = { ...(query as object) } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) => new ListGoalRunsInput(body.goalId === undefined ? null : f.uuid('goalId')),
    );
  }
}

/** MCP report_round (작업 토큰): 이번 회차의 보고 */
export class ReportRoundInput extends BaseRequest {
  private constructor(readonly fields: Partial<GoalRoundRow>) {
    super();
  }

  static from(raw: unknown): ReportRoundInput {
    const body = { ...(raw as object) } as Record<string, unknown>;
    return BaseRequest.read(body, (f) => {
      const items = (name: string) =>
        f.optionalTextList(name, GoalRound.ITEMS_MAX, GoalRound.ITEM_MAX) ?? [];
      return new ReportRoundInput({
        summary: f.text('summary', GoalRound.SUMMARY_MAX),
        completed: items('completed'),
        remaining: items('remaining'),
        evidence: body.evidence === undefined ? [] : ReportRoundInput.evidence(f),
        next_plan: f.optionalText('next_plan', GoalRound.PLAN_MAX) ?? '',
        done: f.boolean('done'),
        milestone: body.milestone === undefined ? false : f.boolean('milestone'),
      });
    });
  }

  /** 근거: [{ url | output_id, note }] → [{ url | outputId, note }] */
  private static evidence(f: RequestFields): readonly Record<string, string>[] {
    return f.nestedList('evidence', GoalRound.EVIDENCE_MAX).map((e) => {
      const url = e.optionalText('url', 2048);
      const outputId = e.optionalText('output_id', 36);
      const note = e.optionalText('note', GoalRound.ITEM_MAX);
      if (!url && !outputId) e.reject('url', 'url이나 output_id 중 하나는 있어야 해요');
      // 화면이 링크로 그린다: http · https만 (javascript: 같은 주소를 결재문에 싣지 않게)
      if (url && !/^https?:\/\/[^\s]+$/i.test(url))
        e.reject('url', 'http · https 주소만 적을 수 있어요');
      return {
        ...(url ? { url } : {}),
        ...(outputId ? { outputId } : {}),
        ...(note ? { note } : {}),
      };
    });
  }
}
