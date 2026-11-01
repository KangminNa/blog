import { Module } from '@nestjs/common';
import { AccountModule } from './modules/account';
import { BlogModule } from './modules/blog';
import { McpModule } from './modules/mcp';
import { PlatformModule } from './modules/platform';
import { TaskModule } from './modules/task';
import { VaultModule } from './modules/vault';

// 모듈: platform(공통 기반) · account · vault · blog · task · mcp. 코드가 생긴 모듈만 넣는다.
@Module({
  imports: [PlatformModule, AccountModule, VaultModule, BlogModule, TaskModule, McpModule],
})
export class AppModule {}
