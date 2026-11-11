import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { ChangeService } from '../change/change.service';
import type { ChangeSetView } from '../change/change.view';
import type { ChangeSet } from '../change/change-set';
import type { Wiki } from './wiki';
import {
  CreateWikiInput,
  ListWikisInput,
  ReplaceWikiInput,
  RestoreWikiInput,
  SaveWikiInput,
  TrashWikiInput,
  WikiIdInput,
} from './wiki.input';
import { WikiQuery } from './wiki.query';
import type {
  PublicWikiDetailView,
  PublicWikiPageView,
  WikiDetailView,
  WikiPageView,
  WikiSavedView,
  WikiTrashView,
} from './wiki.view';

// wiki 메뉴. 읽기는 누구나 볼 수 있는 만큼 (Query가 거른다), 쓰기는 주인만 (변경 묶음으로 남는다).
@Controller('api/wikis')
export class WikiController {
  constructor(
    private readonly wikis: WikiQuery,
    private readonly changes: ChangeService,
  ) {}

  /** ?q=&category=&cursor= 주인은 모든 칸, 그 밖에는 공개 칸만 (Query가 고른다) */
  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
  ): Promise<WikiPageView | PublicWikiPageView> {
    return this.wikis.list(actor, ListWikisInput.from(query));
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<WikiSavedView> {
    return WikiController.saved(await this.changes.edit(actor, CreateWikiInput.from(body)));
  }

  /** 휴지통의 wiki (주인). :id보다 먼저 둔다 */
  @Get('trash')
  trash(@CurrentActor() actor: Actor): Promise<WikiTrashView> {
    return this.wikis.trash(actor);
  }

  @Get(':id')
  get(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<WikiDetailView | PublicWikiDetailView> {
    return this.wikis.get(actor, WikiIdInput.from(id));
  }

  @Put(':id')
  async save(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WikiSavedView> {
    return WikiController.saved(await this.changes.edit(actor, SaveWikiInput.from(id, body)));
  }

  /** 휴지통으로 { version } (주인). 지울 만한 wiki 알림을 본 주인이 지운다. 되살릴 수 있다 */
  @Post(':id/trash')
  @HttpCode(200)
  async trashOne(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WikiSavedView> {
    return WikiController.saved(await this.changes.edit(actor, TrashWikiInput.from(id, body)));
  }

  /** 휴지통에서 꺼내기 { version } (주인) */
  @Post(':id/restore')
  @HttpCode(200)
  async restore(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WikiSavedView> {
    return WikiController.saved(await this.changes.edit(actor, RestoreWikiInput.from(id, body)));
  }

  /** 이 wiki가 옛 wiki를 대체한다 { oldId } (주인). 옛 wiki는 히스토리가 되고 점수를 전부 넘긴다 */
  @Post(':id/replaces')
  async replace(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ChangeSetView> {
    return (await this.changes.edit(actor, ReplaceWikiInput.from(id, body))).view();
  }

  /** 대체 표시를 지운다 (주인). 선은 사람이 지운 선으로 남는다 */
  @Delete(':id/replaces/:oldId')
  async unreplace(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('oldId') oldId: string,
  ): Promise<ChangeSetView> {
    return (await this.changes.edit(actor, ReplaceWikiInput.removing(id, oldId))).view();
  }

  /** 만들거나 고친 wiki 하나 (주인). 화면은 이 version으로 다음 변경을 보낸다 */
  private static saved(set: ChangeSet): WikiSavedView {
    return (set.result as Wiki).view(set.id);
  }
}
