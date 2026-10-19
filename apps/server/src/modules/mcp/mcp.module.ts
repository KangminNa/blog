import { Module } from '@nestjs/common';
import { AccountModule } from '../account';
import { VaultModule } from '../vault';
import { McpController } from './mcp.controller';
import { McpToolbox } from './mcp-toolbox';
import { SkillController } from './skill.controller';
import { SkillQuery } from './skill.query';

// AI 도구의 입구. 비즈니스 규칙을 두지 않고, 각 모듈의 도구를 모아 연다. 앱에 올릴 스킬 묶음도 여기서 내준다.
@Module({
  imports: [AccountModule, VaultModule],
  providers: [McpToolbox, SkillQuery],
  controllers: [McpController, SkillController],
})
export class McpModule {}
