import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { Task } from './task';
import { DelegateTaskInput } from './task.input';
import { TaskService } from './task.service';
import type { DelegatedView } from './task.view';

// MCP 도구 delegate_task: 에이전트가 바로 아래 팀에게 하위 작업을 맡긴다 (에이전트 조직, 객체설계 13장).
// 작업 토큰으로만 부른다. 누가 어느 작업에서 맡기는지는 입력이 아니라 토큰에서 나온다.
// 받는 쪽 · 종류 · 한도는 코드가 막고, 무엇을 나눠 누구에게 맡길지는 AI가 정한다.
@Injectable()
export class DelegateTaskTool extends BaseTool {
  readonly name = 'delegate_task';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly description = [
    '바로 아래 팀원에게 하위 작업을 한 번에 맡긴다 (팀은 일의 "내 팀"에 있다).',
    `한 번에 ${Task.DELEGATE_AT_ONCE}개, 작업 하나에 ${Task.SUBTASKS_MAX}개, 위임 깊이 ${Task.DEPTH_MAX}, 라운드 ${Task.ROUNDS_MAX}까지.`,
    '맡긴 뒤 이 작업은 하위 작업을 기다리고, 이 실행은 여기서 끝낸다.',
    '하위 작업이 모두 끝나면 결과와 함께 이 일이 다시 온다. 결재는 누가 올리든 주인이 한다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      subtasks: {
        type: 'array',
        minItems: 1,
        maxItems: Task.DELEGATE_AT_ONCE,
        items: {
          type: 'object',
          properties: {
            request_id: {
              type: 'string',
              maxLength: 200,
              description: '하위 작업마다 새 id. 응답을 받지 못해 다시 보낼 때는 같은 값을 쓴다',
            },
            to_agent_id: { type: 'string', format: 'uuid', description: '맡을 팀원의 agent_id' },
            kind: {
              type: 'string',
              enum: [...Task.DELEGABLE],
              description: '일의 종류. 팀원의 kinds에 있는 것만 (기본 general)',
            },
            title: { type: 'string', maxLength: 200, description: '하위 작업의 제목' },
            instruction: {
              type: 'string',
              maxLength: 20000,
              description: '팀원이 받을 지시. 팀원은 이 글과 목표만 보고 일한다',
            },
            target_kind: { type: 'string', maxLength: 40, description: '대상의 종류 (예: post)' },
            target_id: { type: 'string', format: 'uuid', description: '대상 id' },
            target_version: { type: 'integer', minimum: 0, description: '대상의 판 번호' },
          },
          required: ['request_id', 'to_agent_id', 'title', 'instruction'],
        },
      },
    },
    required: ['subtasks'],
  };

  constructor(private readonly tasks: TaskService) {
    super();
  }

  /** 작업은 하위 작업을 기다리므로 에이전트는 여기서 멈춘다 */
  async handle(actor: Actor, raw: unknown): Promise<DelegatedView> {
    return Task.delegatedView(await this.tasks.delegate(actor, DelegateTaskInput.from(raw)));
  }
}
