import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { type Actor, CurrentActor, type HttpResponse } from '../../platform';
import { HostedAppsInput, RemoveLogoInput, RenameSpaceInput, UploadLogoInput } from './space.input';
import { SpaceQuery } from './space.query';
import { SpaceService } from './space.service';
import type { SpaceView } from './space.view';

// 블로그 이름·소개·앱 연결 허용. 읽기는 누구나, 쓰기는 주인 (설치 마법사의 블로그 이름 단계, 관리 화면 설정·기기 화면)
// 바꾼 뒤에는 저장한 공간을 돌려주고, 화면은 그 version으로 다음 변경을 보낸다.
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

  /** 로고 올리기 (주인). 본문은 그림 파일 그대로 (HttpSetup이 image/*를 받는다) */
  @Put('logo')
  async uploadLogo(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
    @Body() body: unknown,
  ): Promise<SpaceView> {
    return (await this.service.uploadLogo(actor, UploadLogoInput.from(query, body))).view();
  }

  @HttpCode(200)
  @Post('logo/delete')
  async removeLogo(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<SpaceView> {
    return (await this.service.removeLogo(actor, RemoveLogoInput.from(body))).view();
  }

  /** 로고 보기 (누구나). 브라우저가 형식을 짐작하지 못하게 하고, 그림 안의 무엇도 돌지 않게 sandbox */
  @Get('logo')
  async logo(
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<StreamableFile> {
    const file = await this.spaces.logo(actor);
    res.setHeader('Cache-Control', file.cacheControl);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    return new StreamableFile(file.stream, {
      type: file.blob.mime,
      disposition: 'inline',
      length: file.blob.size,
    });
  }

  @Put('hosted-apps')
  async hostedApps(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<SpaceView> {
    return (await this.service.setHostedApps(actor, HostedAppsInput.from(body))).view();
  }
}
