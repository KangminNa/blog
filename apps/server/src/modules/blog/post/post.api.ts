import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
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
import type {
  PostPageView,
  PostView,
  PublicPostPageView,
  PublicPostView,
  PublicSavedPostView,
  SavedPostView,
} from './post.view';

// 블로그 글. 읽기는 누구나 (보는 사람마다 보이는 글이 다르다), 쓰기는 관리 화면의 편집기.
@Controller('api/posts')
export class PostController {
  constructor(
    private readonly posts: PostQuery,
    private readonly service: PostService,
  ) {}

  /** 방문자: 공개 글을 발행한 순서로. 주인: ?status= 탭(draft · published · unlisted · trash)을 고친 순서로 */
  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
  ): Promise<PostPageView | PublicPostPageView> {
    return this.posts.list(actor, ListPostsInput.from(query));
  }

  @Get('by-slug/:slug')
  bySlug(
    @CurrentActor() actor: Actor,
    @Param('slug') slug: string,
  ): Promise<PostView | PublicPostView> {
    return this.posts.bySlug(actor, PostSlugInput.from(slug));
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<PostView | PublicPostView> {
    return this.posts.get(actor, ReadPostInput.from(id));
  }

  /** 쓰기 결과. revised: 이번 저장으로 새 판이 쌓였는가 */
  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
  ): Promise<SavedPostView | PublicSavedPostView> {
    const post = await this.service.create(actor, CreatePostInput.from(body));
    return post.view(actor);
  }

  @Put(':id')
  async save(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SavedPostView | PublicSavedPostView> {
    const post = await this.service.save(actor, SavePostInput.from(id, body));
    return post.view(actor);
  }

  @HttpCode(200)
  @Post(':id/status')
  async status(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SavedPostView | PublicSavedPostView> {
    const post = await this.service.changeStatus(actor, PostStatusInput.from(id, body));
    return post.view(actor);
  }

  @Delete(':id')
  async trash(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SavedPostView | PublicSavedPostView> {
    const post = await this.service.trash(actor, PostVersionInput.from(id, body));
    return post.view(actor);
  }

  @HttpCode(200)
  @Post(':id/restore')
  async restore(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SavedPostView | PublicSavedPostView> {
    const post = await this.service.recover(actor, PostVersionInput.from(id, body));
    return post.view(actor);
  }
}
