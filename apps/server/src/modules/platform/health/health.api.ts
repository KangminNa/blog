import { Controller, Get } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { HealthQuery } from './health.query';
import type { HealthView } from './health.view';

@Controller('api/health')
export class HealthController {
  constructor(private readonly health: HealthQuery) {}

  @Get()
  status(@CurrentActor() actor: Actor): Promise<HealthView> {
    return this.health.status(actor);
  }
}
