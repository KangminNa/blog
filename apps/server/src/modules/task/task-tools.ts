import { Injectable } from '@nestjs/common';
import type { BaseTool } from '../platform';
import { AiLoginRefreshTool, AiLoginTool, AiSigninTool } from './ai/ai-login.tool';
import { RequestApprovalTool } from './approval/approval.tool';
import { BeginUploadTool } from './output/output.tool';
import { DelegateTaskTool } from './task/delegate.tool';
import {
  NextJobsTool,
  ReleaseJobTool,
  ReportProgressTool,
  SubmitResultTool,
} from './task/task.tool';

// task가 AI에게 여는 MCP 도구 목록. 새 도구는 여기에만 더한다 (mcp 모듈은 모듈별 목록을 모으기만 한다).
@Injectable()
export class TaskTools {
  readonly tools: readonly BaseTool[];

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
    ];
  }
}
