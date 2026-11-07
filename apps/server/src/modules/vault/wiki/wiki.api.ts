import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import { ChangeService } from '../change/change.service';
import type { ChangeSet } from '../change/change-set';
import type { Wiki } from './wiki';
import { CreateWikiInput, ListWikisInput, SaveWikiInput, WikiIdInput } from './wiki.input';
import { WikiQuery } from './wiki.query';
import type { WikiDetailView, WikiPageView, WikiSavedView } from './wiki.view';

/** wiki 목록 한 쪽이나 wiki 하나. 방문자는 공개 칸만 */
export class WikiResponse extends BaseResponse {
  private constructor(
    private readonly view: WikiPageView | WikiDetailView,
    private readonly full: boolean,
  ) {
    super();
  }

  static of(view: WikiPageView | WikiDetailView, actor: Actor): WikiResponse {
    return new WikiResponse(view, actor.canSeePrivate());
  }

  toJSON(): object {
    return this.full ? this.view.toJSON() : this.view.toPublicJSON();
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
  async list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<WikiResponse> {
    return WikiResponse.of(await this.wikis.list(actor, ListWikisInput.from(query)), actor);
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<WikiSavedView> {
    return WikiController.saved(await this.changes.edit(actor, CreateWikiInput.from(body)));
  }

  @Get(':id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<WikiResponse> {
    return WikiResponse.of(await this.wikis.get(actor, WikiIdInput.from(id)), actor);
  }

  @Put(':id')
  async save(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WikiSavedView> {
    return WikiController.saved(await this.changes.edit(actor, SaveWikiInput.from(id, body)));
  }

  /** 만들거나 고친 wiki 하나 (주인). 화면은 이 version으로 다음 변경을 보낸다 */
  private static saved(set: ChangeSet): WikiSavedView {
    return (set.result as Wiki).view(set.id);
  }
}
