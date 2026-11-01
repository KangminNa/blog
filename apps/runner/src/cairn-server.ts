import { Job } from './job';
import type { McpClient } from './mcp-client';
import { type ProgressBatch, ProgressState, type RunResult } from './progress';

// 러너가 쓰는 MCP 도구 네 개. 모양의 원본은 docs/API설계.md 4장이다.
export class CairnServer {
  constructor(private readonly mcp: McpClient) {}

  /** 일을 하나 빌린다. 없으면 waitSeconds까지 기다린다 */
  async nextJobs(waitSeconds: number, stop: AbortSignal): Promise<readonly Job[]> {
    const args = { wait_seconds: waitSeconds, limit: 1 };
    const body = await this.mcp.call('next_jobs', args, waitSeconds * 1000, stop);
    return body.list('jobs').map((job) => Job.from(job));
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
