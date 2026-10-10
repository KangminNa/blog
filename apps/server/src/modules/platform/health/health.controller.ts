import { Controller, Get } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { HealthQuery } from './health.query';
import { HealthResponse } from './health.response';

@Controller('api/health')
export class HealthController {
  constructor(private readonly health: HealthQuery) {}

  @Get()
  async status(@CurrentActor() actor: Actor): Promise<HealthResponse> {
    return HealthResponse.of(await this.health.status(actor));
  }
}
