import { All, Body, Controller, Param, Query, Req } from '@nestjs/common';
import type { Actor } from '../base/actor';
import type { ToolAnswer } from '../base/base-tool';
import { CurrentActor } from '../http/current-actor';
import type { HttpRequest } from '../http/http-types';
import { PackageService } from './package.service';

// 기능 패키지의 API 입구: /api/p/<패키지>/<경로>. 경로와 동작은 패키지의 목록 파일 api가 정한다
// (Nest Controller를 패키지마다 두지 않는다: 패키지는 서버를 다시 시작하지 않고 켜고 끈다).
// 입력은 경로의 값 · 주소의 ?값 · 본문을 합친 것이고, 모양 검사는 동작의 input이 한다.
@Controller('api/p')
export class PackageController {
  constructor(private readonly packages: PackageService) {}

  @All(':plugin/*rest')
  call(
    @CurrentActor() actor: Actor,
    @Req() request: HttpRequest,
    @Param('plugin') plugin: string,
    @Param('rest') rest: string | readonly string[],
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
  ): Promise<ToolAnswer> {
    const path = Array.isArray(rest) ? rest.join('/') : String(rest ?? '');
    const fromBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    return this.packages.call(actor, plugin, request.method, path, { ...query, ...fromBody });
  }
}
