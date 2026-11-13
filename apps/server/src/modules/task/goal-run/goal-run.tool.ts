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
  readonly description = [
    '목표 실행의 회차 작업에서만 쓴다 (지시가 "# 목표 실행 N회차"로 시작하는 일). submit_result로 끝내기 전에 한 번 부른다.',
    '요약, 한 일, 남은 일, 근거(읽은 주소 url · 만든 결과물 output_id와 한 줄 설명), 다음 계획을 적는다.',
    '완료 조건을 모두 채웠을 때만 done: true (주인이 최종 결재로 확인한다). 주인에게 보여야 할 중요한 단계면 milestone: true.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      summary: { type: 'string', maxLength: GoalRound.SUMMARY_MAX, description: '이번 회차 요약' },
      completed: {
        type: 'array',
        maxItems: GoalRound.ITEMS_MAX,
        items: { type: 'string', maxLength: GoalRound.ITEM_MAX },
        description: '이번 회차에 한 일',
      },
      remaining: {
        type: 'array',
        maxItems: GoalRound.ITEMS_MAX,
        items: { type: 'string', maxLength: GoalRound.ITEM_MAX },
        description: '완료 조건까지 남은 일',
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
        description: '근거: 읽은 주소(url)나 만든 결과물(output_id)',
      },
      next_plan: { type: 'string', maxLength: GoalRound.PLAN_MAX, description: '다음 회차 계획' },
      done: { type: 'boolean', description: '완료 조건을 모두 채웠는가' },
      milestone: { type: 'boolean', description: '주인에게 보여야 할 중요한 단계인가' },
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
