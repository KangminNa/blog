import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import {
  CreatePostInput,
  ListPostsInput,
  PostSlugInput,
  PostStatusInput,
  PostVersionInput,
  ReadPostInput,
  SavePostInput,
} from './post.input';
import { PostQuery } from './post.query';
import { PostService } from './post.service';
import type { PostPageView, PostView, SavedPostView } from './post.view';

/**
 * 보는 사람에 맞는 모양. 비공개까지 보는 요청자(주인)에게는 toJSON, 아니면 toPublicJSON:
 * 방문자에게는 읽을 것만, 글을 쓰는 요청자에게는 wiki 연결 없이 (wiki id는 UUIDv7이라 만들어진 때가 드러난다)
 */
export class PostResponse extends BaseResponse {
  private constructor(
    private readonly view: PostPageView | PostView | SavedPostView,
    private readonly full: boolean,
  ) {
    super();
  }

  static of(view: PostPageView | PostView | SavedPostView, actor: Actor): PostResponse {
    return new PostResponse(view, actor.canSeePrivate());
  }

  toJSON(): object {
    return this.full ? this.view.toJSON() : this.view.toPublicJSON();
  }
}

// 블로그 글. 읽기는 누구나 (보는 사람마다 보이는 글이 다르다), 쓰기는 관리 화면의 편집기.
@Controller('api/posts')
export class PostController {
  constructor(
    private readonly posts: PostQuery,
    private readonly service: PostService,
  ) {}

  /** 방문자: 공개 글을 발행한 순서로. 주인: ?status= 탭(draft · published · unlisted · trash)을 고친 순서로 */
  @Get()
  async list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<PostResponse> {
    return PostResponse.of(await this.posts.list(actor, ListPostsInput.from(query)), actor);
  }

  @Get('by-slug/:slug')
  async bySlug(@CurrentActor() actor: Actor, @Param('slug') slug: string): Promise<PostResponse> {
    return PostResponse.of(await this.posts.bySlug(actor, PostSlugInput.from(slug)), actor);
  }

  @Get(':id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<PostResponse> {
    return PostResponse.of(await this.posts.get(actor, ReadPostInput.from(id)), actor);
  }

  /** 쓰기 결과. revised: 이번 저장으로 새 판이 쌓였는가 */
  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<PostResponse> {
    const post = await this.service.create(actor, CreatePostInput.from(body));
    return PostResponse.of(post.view(), actor);
  }

  @Put(':id')
  async save(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostResponse> {
    const post = await this.service.save(actor, SavePostInput.from(id, body));
    return PostResponse.of(post.view(), actor);
  }

  @HttpCode(200)
  @Post(':id/status')
  async status(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostResponse> {
    const post = await this.service.changeStatus(actor, PostStatusInput.from(id, body));
    return PostResponse.of(post.view(), actor);
  }

  @Delete(':id')
  async trash(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostResponse> {
    const post = await this.service.trash(actor, PostVersionInput.from(id, body));
    return PostResponse.of(post.view(), actor);
  }

  @HttpCode(200)
  @Post(':id/restore')
  async restore(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostResponse> {
    const post = await this.service.recover(actor, PostVersionInput.from(id, body));
    return PostResponse.of(post.view(), actor);
  }
}
