import { Body, Controller, Get, Put } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { HostedAppsInput, RenameSpaceInput } from './space.input';
import { SpaceQuery } from './space.query';
import { SpaceService } from './space.service';
import type { SpaceView } from './space.view';

// 블로그 이름·소개·앱 연결 허용. 읽기는 누구나, 쓰기는 주인 (설치 마법사의 블로그 이름 단계, 관리 화면 설정·기기 화면)
@Controller('api/space')
export class SpaceController {
  constructor(
    private readonly spaces: SpaceQuery,
    private readonly service: SpaceService,
  ) {}

  @Get()
  info(@CurrentActor() actor: Actor): Promise<SpaceView> {
    return this.spaces.info(actor);
  }

  @Put()
  async rename(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<SpaceView> {
    return (await this.service.rename(actor, RenameSpaceInput.from(body))).view();
  }

  @Put('hosted-apps')
  async hostedApps(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<SpaceView> {
    return (await this.service.setHostedApps(actor, HostedAppsInput.from(body))).view();
  }
}
