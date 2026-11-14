import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { GoalRound } from './goal-round';
import { ReportRoundInput } from './goal-run.input';
import { GoalRunService } from './goal-run.service';
import type { GoalRoundView } from './goal-run.view';

// MCP 도구 report_round: 목표 실행의 팀장이 회차를 끝내기 전에 보고한다 (작업 토큰).
// 이 보고가 주인의 결재문이 되고 다음 회차의 지시에 실린다. 다음 회차를 열지 · 결재를 올릴지는 서버가 정한다.
@Injectable()
export class ReportRoundTool extends BaseTool {
  readonly name = 'report_round';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      summary: { type: 'string', maxLength: GoalRound.SUMMARY_MAX },
      completed: {
        type: 'array',
        maxItems: GoalRound.ITEMS_MAX,
        items: { type: 'string', maxLength: GoalRound.ITEM_MAX },
      },
      remaining: {
        type: 'array',
        maxItems: GoalRound.ITEMS_MAX,
        items: { type: 'string', maxLength: GoalRound.ITEM_MAX },
      },
      evidence: {
        type: 'array',
        maxItems: GoalRound.EVIDENCE_MAX,
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', maxLength: 2048 },
            output_id: { type: 'string', format: 'uuid' },
            note: { type: 'string', maxLength: GoalRound.ITEM_MAX },
          },
        },
      },
      next_plan: { type: 'string', maxLength: GoalRound.PLAN_MAX },
      done: { type: 'boolean' },
      milestone: { type: 'boolean' },
    },
    required: ['summary', 'done'],
  };

  constructor(private readonly runs: GoalRunService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<GoalRoundView> {
    return (await this.runs.report(actor, ReportRoundInput.from(raw))).view();
  }
}
