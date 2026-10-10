import { Module } from '@nestjs/common';
import { PlatformModule } from './modules/platform';

// 모듈: platform(공통 기반) · account · vault · blog · mcp. 지금은 platform만 있다.
@Module({
  imports: [PlatformModule],
})
export class AppModule {}
