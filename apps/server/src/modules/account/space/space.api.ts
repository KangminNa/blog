import { Body, Controller, Get, Put } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import type { Space } from './space';
import { HostedAppsInput, RenameSpaceInput } from './space.input';
import { SpaceQuery } from './space.query';
import { SpaceService } from './space.service';
import { SpaceView } from './space.view';

/** 블로그 이름·소개·사이트 주소 (누구나). version은 고칠 때 돌려보낸다 */
export class SpaceResponse extends BaseResponse {
  private constructor(private readonly view: SpaceView) {
    super();
  }

  static of(view: SpaceView): SpaceResponse {
    return new SpaceResponse(view);
  }

  /** 저장한 공간. 저장할 수 있었다면 주인이 있으니 설치가 끝난 것이다 */
  static saved(space: Space): SpaceResponse {
    return new SpaceResponse(
      new SpaceView(
        space.name,
        space.description,
        space.siteUrl,
        true,
        space.version,
        space.hostedApps,
      ),
    );
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

// 블로그 이름·소개·앱 연결 허용. 읽기는 누구나, 쓰기는 주인 (설치 마법사의 블로그 이름 단계, 관리 화면 설정·기기 화면)
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
    return SpaceResponse.saved(await this.service.rename(actor, RenameSpaceInput.from(body)));
  }

  @Put('hosted-apps')
  async hostedApps(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<SpaceResponse> {
    return SpaceResponse.saved(await this.service.setHostedApps(actor, HostedAppsInput.from(body)));
  }
}
