import { Controller, Get } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { UsageQuery } from './usage.query';
import type { UsageView } from './usage.view';

// 홈의 사용량: 에이전트별 토큰과 구독 사용률. 주인만 (Query 첫 줄에서 확인).
@Controller('api/usage')
export class UsageController {
  constructor(private readonly usage: UsageQuery) {}

  @Get()
  overview(@CurrentActor() actor: Actor): Promise<UsageView> {
    return this.usage.overview(actor);
  }
}
