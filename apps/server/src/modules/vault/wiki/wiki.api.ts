import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { ChangeService } from '../change/change.service';
import type { ChangeSet } from '../change/change-set';
import type { Wiki } from './wiki';
import { CreateWikiInput, ListWikisInput, SaveWikiInput, WikiIdInput } from './wiki.input';
import { WikiQuery } from './wiki.query';
import type {
  PublicWikiDetailView,
  PublicWikiPageView,
  WikiDetailView,
  WikiPageView,
  WikiSavedView,
} from './wiki.view';

// wiki 메뉴. 읽기는 누구나 볼 수 있는 만큼 (Query가 거른다), 쓰기는 주인만 (변경 묶음으로 남는다).
@Controller('api/wikis')
export class WikiController {
  constructor(
    private readonly wikis: WikiQuery,
    private readonly changes: ChangeService,
  ) {}

  /** ?q=&category=&cursor= */
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

  private static saved(set: ChangeSet): WikiSavedView {
    return (set.result as Wiki).savedView(set.id);
  }
}
