import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { CodeScope } from './code-scope';
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
            },
            to_agent_id: { type: 'string', format: 'uuid' },
            kind: {
              type: 'string',
              enum: [...Task.DELEGABLE],
            },
            title: { type: 'string', maxLength: 200 },
            instruction: {
              type: 'string',
              maxLength: 20000,
            },
            target_kind: { type: 'string', maxLength: 40 },
            target_id: { type: 'string', format: 'uuid' },
            target_version: { type: 'integer', minimum: 0 },
            paths: {
              type: 'array',
              minItems: 1,
              maxItems: CodeScope.PATHS_MAX,
              items: { type: 'string', maxLength: CodeScope.PATH_MAX },
            },
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
