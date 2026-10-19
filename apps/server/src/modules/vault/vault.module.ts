import { Module } from '@nestjs/common';
import { CheckSessionTool } from './session/check-session.tool';
import { SaveSessionTool } from './session/save-session.tool';
import { SensitivePolicy } from './session/sensitive.policy';
import { SessionController } from './session/session.controller';
import { SessionQuery } from './session/session.query';
import { SessionService } from './session/session.service';

// AI 작업 세션과 그래프. 지금은 세션 저장(MCP save_session)과 관리 화면의 세션 목록·상세.
@Module({
  providers: [SensitivePolicy, SessionService, SessionQuery, SaveSessionTool, CheckSessionTool],
  controllers: [SessionController],
  exports: [SaveSessionTool, CheckSessionTool],
})
export class VaultModule {}
