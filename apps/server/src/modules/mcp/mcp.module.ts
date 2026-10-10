import { Module } from '@nestjs/common';
import { AccountModule } from '../account';
import { McpController } from './mcp.controller';
import { McpToolbox } from './mcp-toolbox';

// AI 도구의 입구. 비즈니스 규칙을 두지 않고, 각 모듈의 도구를 모아 연다.
@Module({
  imports: [AccountModule],
  providers: [McpToolbox],
  controllers: [McpController],
})
export class McpModule {}
