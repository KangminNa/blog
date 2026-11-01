import { Module } from '@nestjs/common';
import { CheckSessionTool } from './session/check-session.tool';
import { GetSessionTool } from './session/get-session.tool';
import { SaveSessionTool } from './session/save-session.tool';
import { SearchSessionsTool } from './session/search-sessions.tool';
import { SensitivePolicy } from './session/sensitive.policy';
import { SessionController } from './session/session.controller';
import { SessionQuery } from './session/session.query';
import { SessionService } from './session/session.service';
import { VaultTools } from './vault-tools';

// AI 작업 세션과 그래프. 지금은 세션 저장·찾기·읽기(MCP 도구)와 관리 화면의 세션 목록·상세.
@Module({
  providers: [
    SensitivePolicy,
    SessionService,
    SessionQuery,
    SaveSessionTool,
    CheckSessionTool,
    SearchSessionsTool,
    GetSessionTool,
    VaultTools,
  ],
  controllers: [SessionController],
  exports: [VaultTools, SessionQuery],
})
export class VaultModule {}
