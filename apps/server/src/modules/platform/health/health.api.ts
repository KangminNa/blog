import { Controller, Get } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseResponse } from '../base/base-response';
import { CurrentActor } from '../http/current-actor';
import { HealthQuery } from './health.query';
import type { HealthView } from './health.view';

/**
 * 서버와 DB가 살아 있는지 (운영의 상태 확인). 누구나 status를 받고, 확장 · 마이그레이션 · 표 수는 주인과 서버 자신만:
 * 버전을 짐작할 단서를 방문자에게 주지 않는다. 상태 확인은 응답 코드만 본다 (docker-compose.prod.yml)
 */
export class HealthResponse extends BaseResponse {
  private constructor(
    private readonly view: HealthView,
    private readonly full: boolean,
  ) {
    super();
  }

  static of(view: HealthView, actor: Actor): HealthResponse {
    return new HealthResponse(view, actor.canManage());
  }

  toJSON(): object {
    return this.full ? { status: 'ok', ...this.view.toJSON() } : { status: 'ok' };
  }
}

@Controller('api/health')
export class HealthController {
  constructor(private readonly health: HealthQuery) {}

  @Get()
  async status(@CurrentActor() actor: Actor): Promise<HealthResponse> {
    return HealthResponse.of(await this.health.status(actor), actor);
  }
}
