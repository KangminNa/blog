import { Controller, Get } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import { UsageQuery } from './usage.query';
import type { UsageView } from './usage.view';

/** 에이전트별 토큰과 구독 사용률 */
export class UsageResponse extends BaseResponse {
  private constructor(private readonly view: UsageView) {
    super();
  }

  static of(view: UsageView): UsageResponse {
    return new UsageResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

// 홈의 사용량. 주인만 (Query 첫 줄에서 확인).
@Controller('api/usage')
export class UsageController {
  constructor(private readonly usage: UsageQuery) {}

  @Get()
  async overview(@CurrentActor() actor: Actor): Promise<UsageResponse> {
    return UsageResponse.of(await this.usage.overview(actor));
  }
}
