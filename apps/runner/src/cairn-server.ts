import { Job } from './job';
import type { Json } from './json';
import type { McpClient } from './mcp-client';
import { type ProgressBatch, ProgressState, type RunResult } from './progress';
import type { RunnerAbility } from './runner-ability';

/** ai_signin의 답: 주인이 붙여 넣은 코드(한 번만), 취소됐는가, 작업의 상태 */
export class SigninReply {
  constructor(
    readonly code: string | null,
    readonly cancelled: boolean,
    readonly status: string,
  ) {}

  static from(body: Json): SigninReply {
    return new SigninReply(body.optionalText('code'), body.flag('cancelled'), body.text('status'));
  }
}

// 러너가 쓰는 MCP 도구 일곱 개. 모양의 원본은 docs/API설계.md 4장이다.
export class CairnServer {
  constructor(private readonly mcp: McpClient) {}

  /** 일을 하나 빌린다. 없으면 waitSeconds까지 기다린다. 서버는 이 러너가 할 수 있는 일만 준다 */
  async nextJobs(
    waitSeconds: number,
    stop: AbortSignal,
    ability: RunnerAbility,
  ): Promise<readonly Job[]> {
    const args = { wait_seconds: waitSeconds, limit: 1, ...ability.toArgs() };
    const body = await this.mcp.call('next_jobs', args, waitSeconds * 1000, stop);
    return body.list('jobs').map((job) => Job.from(job));
  }

  /** 콘솔의 AI 로그인과 그 판. 없거나 만료됐으면 서버가 거절한다 (ToolRefused) */
  async aiLogin(
    tool: string,
    stop?: AbortSignal,
  ): Promise<{ token: string; version: number | null }> {
    const body = await this.mcp.call('ai_login', { tool }, 0, stop);
    return { token: body.text('token'), version: body.optionalNumber('version') };
  }

  /**
   * 실행하는 동안 CLI가 갱신한 자격을 되돌려 쓴다 (Codex의 auth.json). 저장한 뒤의 판을 돌려준다.
   * 판이 다르면 conflict (ToolRefused): 다른 실행이 먼저 바꿨다
   */
  async aiLoginRefresh(
    taskId: string,
    tool: string,
    version: number,
    credential: string,
  ): Promise<number> {
    const body = await this.mcp.call('ai_login_refresh', {
      task_id: taskId,
      tool,
      version,
      credential,
    });
    return body.number('version');
  }

  /**
   * 웹 로그인의 한 걸음: 찾은 주소를 알리거나(url, userCode), 자격을 넘기거나(credential), 아무것도 없이 코드와 취소를 묻는다
   */
  async aiSignin(
    taskId: string,
    step: { url?: string; userCode?: string | null; credential?: string } = {},
  ): Promise<SigninReply> {
    const body = await this.mcp.call('ai_signin', {
      task_id: taskId,
      ...(step.url === undefined ? {} : { url: step.url }),
      ...(step.userCode ? { user_code: step.userCode } : {}),
      ...(step.credential === undefined ? {} : { credential: step.credential }),
    });
    return SigninReply.from(body);
  }

  async report(taskId: string, batch: ProgressBatch): Promise<ProgressState> {
    const body = await this.mcp.call('report_progress', {
      task_id: taskId,
      events: batch.events,
      ...(batch.requestId === null ? {} : { request_id: batch.requestId }),
      ...(batch.planUsage.length === 0 ? {} : { plan_usage: batch.planUsage }),
    });
    return ProgressState.from(body);
  }

  async submit(taskId: string, result: RunResult): Promise<void> {
    await this.mcp.call('submit_result', {
      task_id: taskId,
      request_id: result.requestId,
      status: result.status,
      ...(result.text === null ? {} : { result: { text: result.text } }),
      ...(result.error === null ? {} : { error: result.error }),
    });
  }

  async release(taskId: string, reason: string): Promise<void> {
    await this.mcp.call('release_job', { task_id: taskId, reason });
  }
}
