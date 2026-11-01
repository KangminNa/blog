import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import { ChangeService } from '../change/change.service';
import type { ChangeSet } from '../change/change-set';
import type { Wiki } from './wiki';
import { CreateWikiInput, ListWikisInput, SaveWikiInput, WikiIdInput } from './wiki.input';
import { WikiQuery } from './wiki.query';
import { WikiDetailView, type WikiPageView, WikiSectionView, WikiSummaryView } from './wiki.view';

/** wiki 목록 한 쪽. 방문자는 공개 칸만 */
export class WikiPageResponse extends BaseResponse {
  private constructor(
    private readonly page: WikiPageView,
    private readonly full: boolean,
  ) {
    super();
  }

  static of(page: WikiPageView, actor: Actor): WikiPageResponse {
    return new WikiPageResponse(page, actor.canSeePrivate());
  }

  toJSON(): object {
    return this.full ? this.page.toJSON() : this.page.toPublicJSON();
  }
}

/** wiki 하나. 방문자는 공개 칸만 */
export class WikiDetailResponse extends BaseResponse {
  private constructor(
    private readonly detail: WikiDetailView,
    private readonly full: boolean,
  ) {
    super();
  }

  static of(detail: WikiDetailView, actor: Actor): WikiDetailResponse {
    return new WikiDetailResponse(detail, actor.canSeePrivate());
  }

  toJSON(): object {
    return this.full ? this.detail.toJSON() : this.detail.toPublicJSON();
  }
}

/** 만들거나 고친 wiki 하나 (주인). 조회 모양 + 남은 변경 묶음. 화면은 이 version으로 다음 변경을 보낸다 */
export class WikiSavedResponse extends BaseResponse {
  private constructor(private readonly set: ChangeSet) {
    super();
  }

  static of(set: ChangeSet): WikiSavedResponse {
    return new WikiSavedResponse(set);
  }

  toJSON(): object {
    const w = this.set.result as Wiki;
    const summary = new WikiSummaryView(
      w.id,
      w.title,
      w.slug,
      w.categoryId,
      w.visibility,
      w.origin,
      w.revisionCount,
      w.version,
      w.updatedAt,
    );
    const sections = w.body.sections.map((s) => new WikiSectionView(s.key, s.title, s.body));
    return {
      ...new WikiDetailView(summary, w.body.markdown, sections, w.pinnedSections).toJSON(),
      changeSetId: this.set.id,
    };
  }
}

// wiki 메뉴. 읽기는 누구나 볼 수 있는 만큼 (Query가 거른다), 쓰기는 주인만 (변경 묶음으로 남는다).
@Controller('api/wikis')
export class WikiController {
  constructor(
    private readonly wikis: WikiQuery,
    private readonly changes: ChangeService,
  ) {}

  /** ?q=&category=&cursor= */
  @Get()
  async list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<WikiPageResponse> {
    return WikiPageResponse.of(await this.wikis.list(actor, ListWikisInput.from(query)), actor);
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<WikiSavedResponse> {
    return WikiSavedResponse.of(await this.changes.edit(actor, CreateWikiInput.from(body)));
  }

  @Get(':id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<WikiDetailResponse> {
    return WikiDetailResponse.of(await this.wikis.get(actor, WikiIdInput.from(id)), actor);
  }

  @Put(':id')
  async save(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WikiSavedResponse> {
    return WikiSavedResponse.of(await this.changes.edit(actor, SaveWikiInput.from(id, body)));
  }
}
