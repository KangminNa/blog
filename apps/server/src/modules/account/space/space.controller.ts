import { Body, Controller, Get, Put } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { SpaceQuery } from './space.query';
import { HostedAppsRequest, RenameSpaceRequest } from './space.request';
import { SpaceResponse } from './space.response';
import { SpaceService } from './space.service';

// 블로그 이름·소개·앱 연결 허용. 읽기는 누구나, 쓰기는 주인 (설치 마법사의 블로그 이름 단계, 관리 화면 설정·기기 시트)
@Controller('api/space')
export class SpaceController {
  constructor(
    private readonly spaces: SpaceQuery,
    private readonly service: SpaceService,
  ) {}

  @Get()
  async info(@CurrentActor() actor: Actor): Promise<SpaceResponse> {
    return SpaceResponse.of(await this.spaces.info(actor));
  }

  @Put()
  async rename(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<SpaceResponse> {
    return SpaceResponse.saved(await this.service.rename(actor, RenameSpaceRequest.from(body)));
  }

  @Put('hosted-apps')
  async hostedApps(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<SpaceResponse> {
    return SpaceResponse.saved(
      await this.service.setHostedApps(actor, HostedAppsRequest.from(body)),
    );
  }
}
