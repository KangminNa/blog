import { Module, type OnModuleInit } from '@nestjs/common';
import { CoreWorkers } from '../platform';
import { AgentController } from './agent/agent.api';
import { AgentQuery } from './agent/agent.query';
import { AgentService } from './agent/agent.service';
import { ApprovalController } from './approval/approval.api';
import { ApprovalQuery } from './approval/approval.query';
import { ApprovalService } from './approval/approval.service';
import { RequestApprovalTool } from './approval/approval.tool';
import { ApprovalResultHandler } from './approval/approval-result.handler';
import { LeaseJob } from './task/lease.job';
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

// 에이전트가 일하고 주인이 결재하는 구조: 에이전트, 작업(실행 기록), 결재. platform에만 의존한다.
// 결재 뒤 실행은 대상을 가진 모듈이 이벤트로 한다. 그래서 task.approval.granted는 아직 expect하지 않는다:
// 받는 쪽이 생기는 단계에서 적는다 (없는 채로 적으면 일꾼이 뜨지 않는다).
@Module({
  providers: [
    AgentQuery,
    AgentService,
    TaskQuery,
    TaskService,
    ApprovalQuery,
    ApprovalService,
    UsageQuery,
    NextJobsTool,
    ReportProgressTool,
    SubmitResultTool,
    ReleaseJobTool,
    RequestApprovalTool,
    TaskTools,
    TaskRequestedHandler,
    ApprovalResultHandler,
    LeaseJob,
  ],
  controllers: [AgentController, TaskController, ApprovalController, UsageController],
  exports: [TaskTools, TaskQuery],
})
export class TaskModule implements OnModuleInit {
  private static readonly LEASE_CHECK_MS = 30_000;

  constructor(
    private readonly workers: CoreWorkers,
    private readonly requested: TaskRequestedHandler,
    private readonly results: ApprovalResultHandler,
    private readonly leases: LeaseJob,
  ) {}

  onModuleInit(): void {
    this.workers.on(Task.REQUESTED, this.requested);
    this.workers.on('*', this.results);
    this.workers.every(this.leases, TaskModule.LEASE_CHECK_MS);
  }
}
