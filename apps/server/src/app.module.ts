import { Module } from '@nestjs/common';
import { PlatformModule } from './modules/platform/platform.module';

// 모듈 5개(account · vault · blog · platform · mcp) 중 지금은 platform의 DB 연결과 상태 확인만 있다.
@Module({
  imports: [PlatformModule],
})
export class AppModule {}
