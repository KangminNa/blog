import { Module } from '@nestjs/common';
import { AccountModule } from '../account';
import { BlogModule } from '../blog';
import { TaskModule } from '../task';
import { VaultModule } from '../vault';
import { McpController } from './mcp.api';
import { McpToolbox } from './mcp-toolbox';
import { SkillController } from './skill.api';
import { SkillQuery } from './skill.query';
import { ToolTextController } from './tool-text/tool-text.api';
import { ToolTextQuery } from './tool-text/tool-text.query';
import { ToolTextService } from './tool-text/tool-text.service';

// AI 도구의 입구. 각 모듈의 도구를 모아 연다. 앱에 올릴 스킬 묶음, 도구의 글을 콘솔에서 고친 판(도구 설명)도 여기서.
@Module({
  imports: [AccountModule, VaultModule, BlogModule, TaskModule],
  providers: [McpToolbox, SkillQuery, ToolTextQuery, ToolTextService],
  controllers: [McpController, SkillController, ToolTextController],
})
export class McpModule {}
