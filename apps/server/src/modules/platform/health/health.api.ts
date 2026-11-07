import { Controller, Get } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { HealthQuery } from './health.query';
import type { HealthView } from './health.view';

// 서버와 DB가 살아 있는지 (운영의 상태 확인). 누구나 status를 받고, 확장 · 마이그레이션 · 표 수는 주인과 서버 자신만.
@Controller('api/health')
export class HealthController {
  constructor(private readonly health: HealthQuery) {}

  @Get()
  status(@CurrentActor() actor: Actor): Promise<HealthView> {
    return this.health.status(actor);
  }
}
