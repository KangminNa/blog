import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Actor, CurrentActor, type HttpResponse } from '../../platform';
import { EditPageInput, PageSiteInput, ReadPageInput, SwitchPageInput } from './page.input';
import { PageQuery, PageSiteAnswer } from './page.query';
import { PageService } from './page.service';
import type { PageDetailView, PageListView, PageView, PublicPageListView } from './page.view';

// 페이지: AI가 만든 HTML 묶음을 바깥 주소로 내보낸 것. 콘솔의 목록 · 상세 · 고치기는 주인만.
// 바깥 주소(/pages/<이름>/…)는 웹이 site/…로 넘긴다: 공개 페이지는 누구나, 비공개는 주인만 본다.
@Controller('api/pages')
export class PageController {
  constructor(
    private readonly pages: PageQuery,
    private readonly service: PageService,
  ) {}

  /** 주인: 모든 페이지. 방문자: 공개 페이지의 이름 · 제목 */
  @Get()
  list(@CurrentActor() actor: Actor): Promise<PageListView | PublicPageListView> {
    return this.pages.list(actor);
  }

  /** 바깥 주소의 파일. 늘 격리 머리글을 붙인다: 페이지의 스크립트가 주인의 로그인에 닿지 못하게 */
  @Get('site/*path')
  async site(
    @CurrentActor() actor: Actor,
    @Param('path') path: string | readonly string[],
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<StreamableFile | undefined> {
    const answer = await this.pages.site(actor, PageSiteInput.from(path), new Date());
    res.setHeader('Content-Security-Policy', PageSiteAnswer.CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', answer.cacheControl);
    if (answer.redirect !== null || answer.stream === null) {
      res.redirect(302, answer.redirect ?? PageQuery.SITE);
      return undefined;
    }
    return new StreamableFile(answer.stream, {
      type: answer.type,
      disposition: 'inline',
      length: answer.size,
    });
  }

  @Get(':id')
  detail(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<PageDetailView> {
    return this.pages.detail(actor, ReadPageInput.from(id));
  }

  /** 제목 · 공개 범위 */
  @Patch(':id')
  async edit(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PageView> {
    return (await this.service.edit(actor, EditPageInput.from(id, body))).view();
  }

  /** 보이는 판을 옮긴다 (되돌리기) */
  @HttpCode(200)
  @Post(':id/current')
  async switchTo(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PageView> {
    return (await this.service.switchTo(actor, SwitchPageInput.from(id, body))).view();
  }
}
