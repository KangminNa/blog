import { Module, type OnModuleInit } from '@nestjs/common';
import { BlobStore, CoreWorkers, Leases, SecretRotation } from '../platform';
import { AgentController } from './agent/agent.api';
import { AgentQuery } from './agent/agent.query';
import { AgentService } from './agent/agent.service';
import { AgentTeamController } from './agent/agent-team.api';
import { AiLoginController } from './ai/ai-login.api';
import { AiLoginQuery } from './ai/ai-login.query';
import { AiLoginService } from './ai/ai-login.service';
import { AiLoginRefreshTool, AiLoginTool, AiSigninTool } from './ai/ai-login.tool';
import { ApprovalController } from './approval/approval.api';
import { ApprovalQuery } from './approval/approval.query';
import { ApprovalService } from './approval/approval.service';
import { RequestApprovalTool } from './approval/approval.tool';
import { ApprovalResultHandler } from './approval/approval-result.handler';
import { ChatController } from './chat/chat.api';
import { ChatQuery } from './chat/chat.query';
import { ChatService } from './chat/chat.service';
import { AskAgentTool } from './chat/chat.tool';
import { ChatUpdateHandler } from './chat/chat-update.handler';
import { ChatUpdateQuery } from './chat/chat-update.query';
import { ChatUpdateService } from './chat/chat-update.service';
import { AgentUpdatesTool, PostUpdateTool } from './chat/chat-update.tool';
import { GoalController } from './goal/goal.api';
import { GoalQuery } from './goal/goal.query';
import { GoalService } from './goal/goal.service';
import { GoalRunController } from './goal-run/goal-run.api';
import { GoalRunHandler } from './goal-run/goal-run.handler';
import { GoalRunQuery } from './goal-run/goal-run.query';
import { GoalRunService } from './goal-run/goal-run.service';
import { ReportRoundTool } from './goal-run/goal-run.tool';
import { HomeController } from './home/home.api';
import { HomeQuery } from './home/home.query';
import { OutputController } from './output/output.api';
import { OutputPolicy } from './output/output.policy';
import { OutputQuery } from './output/output.query';
import { OutputService } from './output/output.service';
import { BeginDownloadTool, BeginUploadTool } from './output/output.tool';
import { OutputPurgeJob } from './output/output-purge.job';
import { RunnerController } from './runner/runner.api';
import { RunnerQuery } from './runner/runner.query';
import { RunnerService } from './runner/runner.service';
import { ScheduleController } from './schedule/schedule.api';
import { ScheduleJob } from './schedule/schedule.job';
import { ScheduleQuery } from './schedule/schedule.query';
import { ScheduleService } from './schedule/schedule.service';
import { RepoSkillGateway } from './skill/repo-skill.gateway';
import { SkillController } from './skill/skill.api';
import { SkillQuery } from './skill/skill.query';
import { SkillService } from './skill/skill.service';
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
import { TaskNotices } from './task-notices';
import { TaskTools } from './task-tools';
import { UsageController } from './usage/usage.api';
import { UsageQuery } from './usage/usage.query';
import { WebQuery } from './web/web.query';
import { ReadUrlTool } from './web/web.tool';
import { WebPageGateway } from './web/web-page.gateway';

// 에이전트가 일하고 주인이 결재하는 구조: 에이전트(조직도 · 하트비트), 목표, 작업(실행 기록 · 위임), 결재. platform에만 의존한다.
// 결재 뒤 실행은 대상을 가진 모듈이 이벤트로 한다. task.approval.granted를 받는 모듈이 expect도 적는다 (지금은 blog).
@Module({
  providers: [
    TaskNotices,
    AgentQuery,
    AgentService,
    TaskQuery,
    TaskService,
    ApprovalQuery,
    ApprovalService,
    UsageQuery,
    HomeQuery,
    GoalQuery,
    GoalService,
    ScheduleQuery,
    ScheduleService,
    ScheduleJob,
    RunnerQuery,
    RunnerService,
    AiLoginQuery,
    AiLoginService,
    AiLoginTool,
    AiLoginRefreshTool,
    AiSigninTool,
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
    // 저장소 skills/의 러너 스킬 (서버 이미지에 함께 든 판). 처음 한 번 읽는다
    { provide: RepoSkillGateway, useFactory: () => RepoSkillGateway.fromEnv() },
    SkillQuery,
    SkillService,
    // 결과물의 공간 한도 · 디스크 여유 (CAIRN_OUTPUTS_MAX_GB · CAIRN_DISK_RESERVE_GB)
    { provide: OutputPolicy, useFactory: () => OutputPolicy.fromEnv() },
    OutputQuery,
    OutputService,
    BeginUploadTool,
    // 목표 실행: 회차 루프와 결재 (GoalRunHandler가 회차 끝 · 결재를 받는다)
    GoalRunQuery,
    GoalRunService,
    ChatQuery,
    ChatService,
    AskAgentTool,
    // 대화의 소식 (2차 1-1): 끝난 작업 → 소식(ChatUpdateHandler), agent_updates · post_update
    ChatUpdateService,
    ChatUpdateQuery,
    ChatUpdateHandler,
    AgentUpdatesTool,
    PostUpdateTool,
    GoalRunHandler,
    ReportRoundTool,
    // 주소 읽기 (read_url): 서버가 AI 대신 연다. 목줄은 WebReach
    WebPageGateway,
    WebQuery,
    ReadUrlTool,
    BeginDownloadTool,
    OutputPurgeJob,
  ],
  controllers: [
    AgentController,
    AgentTeamController,
    TaskController,
    ApprovalController,
    UsageController,
    HomeController,
    AiLoginController,
    GoalController,
    ScheduleController,
    RunnerController,
    SkillController,
    OutputController,
    GoalRunController,
    ChatController,
  ],
  exports: [TaskTools, TaskQuery],
})
export class TaskModule implements OnModuleInit {
  private static readonly LEASE_CHECK_MS = 30_000;
  /** 스케줄의 가장 작은 단위가 분이라 1분마다 본다 */
  private static readonly SCHEDULE_CHECK_MS = 60_000;

  constructor(
    private readonly workers: CoreWorkers,
    private readonly requested: TaskRequestedHandler,
    private readonly settled: SubtaskSettledHandler,
    private readonly chatUpdates: ChatUpdateHandler,
    private readonly results: ApprovalResultHandler,
    private readonly leases: LeaseJob,
    private readonly schedules: ScheduleJob,
    private readonly rotation: SecretRotation,
    private readonly logins: AiLoginService,
    private readonly outputPurge: OutputPurgeJob,
    private readonly blobs: BlobStore,
    private readonly outputs: OutputQuery,
    private readonly leaseChecks: Leases,
    private readonly tasks: TaskQuery,
    private readonly goalRuns: GoalRunHandler,
  ) {}

  onModuleInit(): void {
    this.workers.on(Task.REQUESTED, this.requested);
    this.workers.on(Task.CHANGED, this.settled);
    this.workers.on(Task.CHANGED, this.chatUpdates);
    this.workers.on(Task.CHANGED, this.goalRuns);
    for (const topic of GoalRunHandler.DECIDED) this.workers.on(topic, this.goalRuns);
    this.workers.on('*', this.results);
    this.workers.every(this.leases, TaskModule.LEASE_CHECK_MS);
    this.workers.every(this.schedules, TaskModule.SCHEDULE_CHECK_MS);
    this.rotation.register('task.ai_logins', (actor) => this.logins.resealSecrets(actor));
    this.workers.every(this.outputPurge, OutputPurgeJob.EVERY_MS);
    // 기능 패키지의 도구(code-github의 code_credential 등)가 묻는 임대 확인
    this.leaseChecks.register((actor, id) => this.tasks.leasedWork(actor, id));
    // 결과물이 가리키는 파일: 쓰는 동안 platform이 지우지 않게
    this.blobs.registerUse(['task.outputs.blob_hash'], (actor, hashes) =>
      this.outputs.usedBlobs(actor, hashes),
    );
  }
}
