import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { PlanUsage } from '../usage/plan-usage';
import { type JobStateView, NextJobsView, type ProgressView } from './job.view';
import {
  NextJobsInput,
  ReleaseJobInput,
  ReportProgressInput,
  SubmitResultInput,
} from './task.input';
import { TaskService } from './task.service';

// 러너가 쓰는 MCP 도구 (run 권한). 러너는 일을 빌리고, AI CLI에게는 작업 토큰만 준다.
// 입력 모양을 바꾸면 러너와 스킬을 함께 고친다. 깨지는 변경은 새 도구 이름으로 (API설계 2장).

@Injectable()
export class NextJobsTool extends BaseTool {
  readonly name = 'next_jobs';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      wait_seconds: {
        type: 'integer',
        minimum: 0,
        maximum: NextJobsInput.WAIT_MAX,
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: NextJobsInput.LIMIT_MAX,
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        maxItems: NextJobsInput.TOOLS_MAX,
      },
      signin_tools: {
        type: 'array',
        items: { type: 'string' },
        maxItems: NextJobsInput.TOOLS_MAX,
      },
      own_logins: {
        type: 'array',
        items: { type: 'string' },
        maxItems: NextJobsInput.TOOLS_MAX,
      },
      runner_build: {
        type: 'string',
        maxLength: NextJobsInput.BUILD_MAX,
      },
      cli_versions: {
        type: 'object',
        additionalProperties: { type: 'string', maxLength: NextJobsInput.BUILD_MAX },
      },
      browser: {
        type: 'boolean',
      },
    },
  };

  constructor(private readonly tasks: TaskService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<NextJobsView> {
    return new NextJobsView(await this.tasks.next(actor, NextJobsInput.from(raw)));
  }
}

@Injectable()
export class ReportProgressTool extends BaseTool {
  readonly name = 'report_progress';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      request_id: {
        type: 'string',
        maxLength: 200,
      },
      events: {
        type: 'array',
        maxItems: ReportProgressInput.EVENTS_MAX,
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['read', 'write', 'result', 'error'],
            },
            body: { type: 'string', maxLength: 20_000 },
            tokens: { type: 'integer', minimum: 0 },
          },
          required: ['kind'],
        },
      },
      model: {
        type: 'string',
        maxLength: ReportProgressInput.MODEL_MAX,
      },
      plan_usage: {
        type: 'array',
        maxItems: ReportProgressInput.PLAN_USAGE_MAX,
        items: {
          type: 'object',
          properties: {
            window: { type: 'string', maxLength: 40 },
            percent: {
              type: 'integer',
              minimum: 0,
              maximum: PlanUsage.PERCENT_MAX,
            },
            resets_at: { type: 'string', format: 'date-time' },
            status: {
              type: 'string',
              enum: PlanUsage.STATUSES,
            },
          },
          required: ['window', 'percent', 'resets_at'],
        },
      },
    },
    required: ['task_id', 'events'],
  };

  constructor(private readonly tasks: TaskService) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<ProgressView> {
    return this.tasks.report(actor, ReportProgressInput.from(raw));
  }
}

@Injectable()
export class SubmitResultTool extends BaseTool {
  readonly name = 'submit_result';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      request_id: {
        type: 'string',
        maxLength: 200,
      },
      status: { type: 'string', enum: ['done', 'failed'] },
      result: { type: 'object' },
      error: { type: 'string', maxLength: 4000 },
    },
    required: ['task_id', 'request_id', 'status'],
  };

  constructor(private readonly tasks: TaskService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<JobStateView> {
    return (await this.tasks.submit(actor, SubmitResultInput.from(raw))).stateView();
  }
}

@Injectable()
export class ReleaseJobTool extends BaseTool {
  readonly name = 'release_job';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      reason: { type: 'string', maxLength: 1000 },
    },
    required: ['task_id', 'reason'],
  };

  constructor(private readonly tasks: TaskService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<JobStateView> {
    return (await this.tasks.release(actor, ReleaseJobInput.from(raw))).stateView();
  }
}
