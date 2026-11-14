import { Injectable } from '@nestjs/common';
import type { BaseTool, ToolTextBody } from '../platform';
import { AiLoginRefreshTool, AiLoginTool, AiSigninTool } from './ai/ai-login.tool';
import { RequestApprovalTool } from './approval/approval.tool';
import { AgentReplyTool, AskAgentTool } from './chat/chat.tool';
import { ReportRoundTool } from './goal-run/goal-run.tool';
import { BeginDownloadTool, BeginUploadTool } from './output/output.tool';
import { DelegateTaskTool } from './task/delegate.tool';
import {
  NextJobsTool,
  ReleaseJobTool,
  ReportProgressTool,
  SubmitResultTool,
} from './task/task.tool';
import texts from './task.tools.ko.json';
import { ReadUrlTool } from './web/web.tool';

// task가 AI에게 여는 MCP 도구 목록. 새 도구는 여기에만 더한다 (mcp 모듈은 모듈별 목록을 모으기만 한다).
@Injectable()
export class TaskTools {
  readonly tools: readonly BaseTool[];
  /** 도구의 설명 · 칸 설명 (AI가 읽는 글). 코드가 아니라 설명서 파일이 기본이다 */
  readonly texts: Readonly<Record<string, ToolTextBody>> = texts;

  constructor(
    nextJobs: NextJobsTool,
    reportProgress: ReportProgressTool,
    submitResult: SubmitResultTool,
    releaseJob: ReleaseJobTool,
    requestApproval: RequestApprovalTool,
    delegateTask: DelegateTaskTool,
    aiLogin: AiLoginTool,
    aiLoginRefresh: AiLoginRefreshTool,
    aiSignin: AiSigninTool,
    beginUpload: BeginUploadTool,
    beginDownload: BeginDownloadTool,
    readUrl: ReadUrlTool,
    reportRound: ReportRoundTool,
    askAgent: AskAgentTool,
    agentReply: AgentReplyTool,
  ) {
    this.tools = [
      nextJobs,
      reportProgress,
      submitResult,
      releaseJob,
      requestApproval,
      delegateTask,
      aiLogin,
      aiLoginRefresh,
      aiSignin,
      beginUpload,
      beginDownload,
      readUrl,
      reportRound,
      askAgent,
      agentReply,
    ];
  }
}
