import { Injectable } from '@nestjs/common';
import { Actor, BaseResponse, BaseTool } from '../../platform';
import { PlanUsage } from '../usage/plan-usage';
import type { Task } from './task';
import {
  NextJobsInput,
  ReleaseJobInput,
  ReportProgressInput,
  SubmitResultInput,
} from './task.input';
import { TaskService } from './task.service';
import type { JobView, ProgressView } from './task.view';

// 러너가 쓰는 MCP 도구 (run 권한). 러너는 일을 빌리고, AI CLI에게는 작업 토큰만 준다.
// 입력 모양을 바꾸면 러너와 스킬을 함께 고친다. 깨지는 변경은 새 도구 이름으로 (API설계 2장).

/** next_jobs의 답 */
export class NextJobsResponse extends BaseResponse {
  private constructor(private readonly jobs: readonly JobView[]) {
    super();
  }

  static of(jobs: readonly JobView[]): NextJobsResponse {
    return new NextJobsResponse(jobs);
  }

  toJSON(): object {
    return { jobs: this.jobs.map((j) => j.toJSON()) };
  }
}

/** report_progress의 답 */
export class ProgressResponse extends BaseResponse {
  private constructor(private readonly view: ProgressView) {
    super();
  }

  static of(view: ProgressView): ProgressResponse {
    return new ProgressResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

/** submit_result · release_job의 답 */
export class JobStateResponse extends BaseResponse {
  private constructor(private readonly task: Task) {
    super();
  }

  static of(task: Task): JobStateResponse {
    return new JobStateResponse(task);
  }

  toJSON(): object {
    return { task_id: this.task.id, status: this.task.status };
  }
}

@Injectable()
export class NextJobsTool extends BaseTool {
  readonly name = 'next_jobs';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  readonly description = [
    '할 일을 빌린다 (임대 15분). 일이 없으면 wait_seconds까지 기다리다가 일이 생기면 바로 돌려준다.',
    '일마다 지시, 대상, 스킬, 에이전트, 작업 토큰(run_token)이 온다. AI CLI에게는 run_token만 넘긴다.',
    '일하는 동안 report_progress로 임대를 늘리고, 끝나면 submit_result, 못 하면 release_job을 부른다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      wait_seconds: {
        type: 'integer',
        minimum: 0,
        maximum: NextJobsInput.WAIT_MAX,
        description: '일이 없을 때 기다릴 시간. 기본 0',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: NextJobsInput.LIMIT_MAX,
        description: '한 번에 빌릴 일의 수. 기본 1',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        maxItems: NextJobsInput.TOOLS_MAX,
        description:
          '실행할 수 있는 AI CLI (예: ["claude"]). 그 도구의 로그인이 쓸 수 있을 때만 그 도구의 일을 준다',
      },
      signin_tools: {
        type: 'array',
        items: { type: 'string' },
        maxItems: NextJobsInput.TOOLS_MAX,
        description: '웹 로그인을 대신 돌릴 수 있는 CLI (예: ["claude", "codex"])',
      },
      own_logins: {
        type: 'array',
        items: { type: 'string' },
        maxItems: NextJobsInput.TOOLS_MAX,
        description:
          '러너가 스스로 가진 로그인 (환경 변수 등). 서버의 로그인이 없어도 그 도구의 일을 준다',
      },
    },
  };

  constructor(private readonly tasks: TaskService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<NextJobsResponse> {
    return NextJobsResponse.of(await this.tasks.next(actor, NextJobsInput.from(raw)));
  }
}

@Injectable()
export class ReportProgressTool extends BaseTool {
  readonly name = 'report_progress';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly description = [
    '실행 기록을 모아 남기고 임대를 늘린다. 임대가 끝나기 전에 부르고, 남길 기록이 없으면 events를 비워 부른다.',
    'AI CLI가 알려 준 구독 사용률이 있으면 plan_usage로 함께 보낸다. 어느 도구의 값인지는 서버가 작업의 에이전트로 정한다.',
    '답의 cancelled가 true면 작업을 멈춘다. paused가 true면 에이전트가 멈춘 것이니 release_job으로 돌려줄 수 있다.',
    'status가 waiting이면 결재를 기다리는 중이니 이 실행을 끝낸다. submit_result는 부르지 않는다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid', description: '작업 id' },
      request_id: {
        type: 'string',
        maxLength: 200,
        description: '이 보고의 id. 다시 보낼 때 같은 값을 쓰면 토큰을 두 번 세지 않는다',
      },
      events: {
        type: 'array',
        maxItems: ReportProgressInput.EVENTS_MAX,
        description: '실행 기록. 비어 있어도 된다',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['read', 'write', 'result', 'error'],
              description: '기록 종류',
            },
            body: { type: 'string', maxLength: 20_000, description: '기록 내용' },
            tokens: { type: 'integer', minimum: 0, description: '이번에 쓴 토큰 수' },
          },
          required: ['kind'],
        },
      },
      plan_usage: {
        type: 'array',
        maxItems: ReportProgressInput.PLAN_USAGE_MAX,
        description:
          '구독 사용률 창들. 없어도 된다. five_hour · seven_day만 저장하고 모르는 창은 넘어간다',
        items: {
          type: 'object',
          properties: {
            window: { type: 'string', maxLength: 40, description: '창 이름' },
            percent: {
              type: 'integer',
              minimum: 0,
              maximum: PlanUsage.PERCENT_MAX,
              description: '사용률. 초과 사용이면 100을 넘는다',
            },
            resets_at: { type: 'string', format: 'date-time', description: '초기화 시각' },
            status: {
              type: 'string',
              enum: PlanUsage.STATUSES,
              description: 'AI CLI가 알려 준 상태',
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

  async handle(actor: Actor, raw: unknown): Promise<ProgressResponse> {
    return ProgressResponse.of(await this.tasks.report(actor, ReportProgressInput.from(raw)));
  }
}

@Injectable()
export class SubmitResultTool extends BaseTool {
  readonly name = 'submit_result';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly description = [
    '작업을 끝낸다. status는 done이나 failed이고, 실패면 error에 이유를 적는다. 임대가 살아 있어야 한다.',
    '임대가 끝났거나 결재를 기다리는 작업은 끝낼 수 없다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid', description: '작업 id' },
      request_id: {
        type: 'string',
        maxLength: 200,
        description: '이 요청의 id. 응답을 받지 못해 다시 보낼 때는 같은 값을 쓴다',
      },
      status: { type: 'string', enum: ['done', 'failed'], description: '어떻게 끝났는가' },
      result: { type: 'object', description: '결과' },
      error: { type: 'string', maxLength: 4000, description: '실패했을 때의 이유' },
    },
    required: ['task_id', 'request_id', 'status'],
  };

  constructor(private readonly tasks: TaskService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<JobStateResponse> {
    return JobStateResponse.of(await this.tasks.submit(actor, SubmitResultInput.from(raw)));
  }
}

@Injectable()
export class ReleaseJobTool extends BaseTool {
  readonly name = 'release_job';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  readonly description = '처리하지 못한 일을 돌려준다. 다른 러너가 다시 빌려 갈 수 있다.';
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid', description: '작업 id' },
      reason: { type: 'string', maxLength: 1000, description: '돌려주는 이유' },
    },
    required: ['task_id', 'reason'],
  };

  constructor(private readonly tasks: TaskService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<JobStateResponse> {
    return JobStateResponse.of(await this.tasks.release(actor, ReleaseJobInput.from(raw)));
  }
}
