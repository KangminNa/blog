import { Module } from '@nestjs/common';
import { AccountModule } from './modules/account';
import { McpModule } from './modules/mcp';
import { PlatformModule } from './modules/platform';

// 모듈: platform(공통 기반) · account · vault · blog · mcp. 코드가 생긴 모듈만 넣는다.
@Module({
  imports: [PlatformModule, AccountModule, McpModule],
})
export class AppModule {}
