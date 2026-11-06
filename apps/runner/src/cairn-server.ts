import { Job } from './job';
import type { Json } from './json';
import type { McpClient } from './mcp-client';
import { type ProgressBatch, ProgressState, type RunResult } from './progress';

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

// 러너가 쓰는 MCP 도구 여섯 개. 모양의 원본은 docs/API설계.md 4장이다.
export class CairnServer {
  constructor(private readonly mcp: McpClient) {}

  /** 일을 하나 빌린다. 없으면 waitSeconds까지 기다린다. kinds가 있으면 그 종류만 */
  async nextJobs(
    waitSeconds: number,
    stop: AbortSignal,
    kinds: readonly string[] | null = null,
  ): Promise<readonly Job[]> {
    const args = { wait_seconds: waitSeconds, limit: 1, ...(kinds === null ? {} : { kinds }) };
    const body = await this.mcp.call('next_jobs', args, waitSeconds * 1000, stop);
    return body.list('jobs').map((job) => Job.from(job));
  }

  /** 콘솔에 넣은 AI 토큰. 없거나 만료됐으면 서버가 거절한다 (ToolRefused) */
  async aiLogin(tool: string, stop?: AbortSignal): Promise<string> {
    return (await this.mcp.call('ai_login', { tool }, 0, stop)).text('token');
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
