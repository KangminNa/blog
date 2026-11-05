import { Controller, Get } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseResponse } from '../base/base-response';
import { CurrentActor } from '../http/current-actor';
import { HealthQuery } from './health.query';
import type { HealthView } from './health.view';

/** 서버와 DB가 살아 있는지 (웹의 첫 화면, 운영의 상태 확인) */
export class HealthResponse extends BaseResponse {
  private constructor(private readonly view: HealthView) {
    super();
  }

  static of(view: HealthView): HealthResponse {
    return new HealthResponse(view);
  }

  toJSON(): object {
    return { status: 'ok', ...this.view.toJSON() };
  }
}

@Controller('api/health')
export class HealthController {
  constructor(private readonly health: HealthQuery) {}

  @Get()
  async status(@CurrentActor() actor: Actor): Promise<HealthResponse> {
    return HealthResponse.of(await this.health.status(actor));
  }
}
