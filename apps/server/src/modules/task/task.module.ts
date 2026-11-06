import { Module, type OnModuleInit } from '@nestjs/common';
import { CoreWorkers, SecretRotation } from '../platform';
import { AgentController } from './agent/agent.api';
import { AgentQuery } from './agent/agent.query';
import { AgentService } from './agent/agent.service';
import { AiLoginController } from './ai/ai-login.api';
import { AiLoginQuery } from './ai/ai-login.query';
import { AiLoginService } from './ai/ai-login.service';
import { AiLoginTool } from './ai/ai-login.tool';
import { ApprovalController } from './approval/approval.api';
import { ApprovalQuery } from './approval/approval.query';
import { ApprovalService } from './approval/approval.service';
import { RequestApprovalTool } from './approval/approval.tool';
import { ApprovalResultHandler } from './approval/approval-result.handler';
import { GoalController } from './goal/goal.api';
import { GoalQuery } from './goal/goal.query';
import { GoalService } from './goal/goal.service';
import { HeartbeatController } from './heartbeat/heartbeat.api';
import { HeartbeatJob } from './heartbeat/heartbeat.job';
import { HeartbeatService } from './heartbeat/heartbeat.service';
import { RunnerController } from './runner/runner.api';
import { RunnerQuery } from './runner/runner.query';
import { RunnerService } from './runner/runner.service';
import { DelegateTaskTool } from './task/delegate.tool';
import { LeaseJob } from './task/lease.job';
import { SubtaskSettledHandler } from './task/subtask-settled.handler';
import { Task } from './task/task';
import { TaskController } from './task/task.api';
import { TaskQuery } from './task/task.query';
import { TaskService } from './task/task.service';
import {
  NextJobsTool,
  ReleaseJobTool,
  ReportProgressTool,
  SubmitResultTool,
} from './task/task.tool';
import { TaskRequestedHandler } from './task/task-requested.handler';
import { TaskTools } from './task-tools';
import { UsageController } from './usage/usage.api';
import { UsageQuery } from './usage/usage.query';

// 에이전트가 일하고 주인이 결재하는 구조: 에이전트(조직도 · 하트비트), 목표, 작업(실행 기록 · 위임), 결재. platform에만 의존한다.
// 결재 뒤 실행은 대상을 가진 모듈이 이벤트로 한다. task.approval.granted를 받는 모듈이 expect도 적는다 (지금은 blog).
@Module({
  providers: [
    AgentQuery,
    AgentService,
    TaskQuery,
    TaskService,
    ApprovalQuery,
    ApprovalService,
    UsageQuery,
    GoalQuery,
    GoalService,
    HeartbeatService,
    HeartbeatJob,
    RunnerQuery,
    RunnerService,
    AiLoginQuery,
    AiLoginService,
    AiLoginTool,
    NextJobsTool,
    ReportProgressTool,
    SubmitResultTool,
    ReleaseJobTool,
    RequestApprovalTool,
    DelegateTaskTool,
    TaskTools,
    TaskRequestedHandler,
    SubtaskSettledHandler,
    ApprovalResultHandler,
    LeaseJob,
  ],
  controllers: [
    AgentController,
    TaskController,
    ApprovalController,
    UsageController,
    AiLoginController,
    GoalController,
    HeartbeatController,
    RunnerController,
  ],
  exports: [TaskTools, TaskQuery],
})
export class TaskModule implements OnModuleInit {
  private static readonly LEASE_CHECK_MS = 30_000;
  /** 하트비트의 가장 작은 단위가 분이라 1분마다 본다 */
  private static readonly HEARTBEAT_CHECK_MS = 60_000;

  constructor(
    private readonly workers: CoreWorkers,
    private readonly requested: TaskRequestedHandler,
    private readonly settled: SubtaskSettledHandler,
    private readonly results: ApprovalResultHandler,
    private readonly leases: LeaseJob,
    private readonly heartbeats: HeartbeatJob,
    private readonly rotation: SecretRotation,
    private readonly logins: AiLoginService,
  ) {}

  onModuleInit(): void {
    this.workers.on(Task.REQUESTED, this.requested);
    this.workers.on(Task.CHANGED, this.settled);
    this.workers.on('*', this.results);
    this.workers.every(this.leases, TaskModule.LEASE_CHECK_MS);
    this.workers.every(this.heartbeats, TaskModule.HEARTBEAT_CHECK_MS);
    this.rotation.register('task.ai_logins', (actor) => this.logins.resealSecrets(actor));
  }
}
