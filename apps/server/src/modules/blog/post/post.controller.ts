import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { PostQuery } from './post.query';
import {
  CreatePostRequest,
  ListPostsRequest,
  PostSlugRequest,
  PostStatusRequest,
  PostVersionRequest,
  ReadPostRequest,
  SavePostRequest,
} from './post.request';
import { PostListResponse, PostResponse, PostSavedResponse } from './post.response';
import { PostService } from './post.service';

// 블로그 글. 읽기는 누구나 (보는 사람마다 보이는 글이 다르다), 쓰기는 관리 화면의 편집기.
@Controller('api/posts')
export class PostController {
  constructor(
    private readonly posts: PostQuery,
    private readonly service: PostService,
  ) {}

  /** 방문자: 공개 글을 발행한 순서로. 주인: ?status= 탭(draft · published · unlisted · trash)을 고친 순서로 */
  @Get()
  async list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<PostListResponse> {
    return PostListResponse.of(await this.posts.list(actor, ListPostsRequest.from(query)));
  }

  @Get('by-slug/:slug')
  async bySlug(@CurrentActor() actor: Actor, @Param('slug') slug: string): Promise<PostResponse> {
    return PostResponse.of(await this.posts.bySlug(actor, PostSlugRequest.from(slug)));
  }

  @Get(':id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<PostResponse> {
    return PostResponse.of(await this.posts.get(actor, ReadPostRequest.from(id)));
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<PostSavedResponse> {
    return PostSavedResponse.of(await this.service.create(actor, CreatePostRequest.from(body)));
  }

  @Put(':id')
  async save(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostSavedResponse> {
    return PostSavedResponse.of(await this.service.save(actor, SavePostRequest.from(id, body)));
  }

  @HttpCode(200)
  @Post(':id/status')
  async status(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostSavedResponse> {
    return PostSavedResponse.of(
      await this.service.changeStatus(actor, PostStatusRequest.from(id, body)),
    );
  }

  @Delete(':id')
  async trash(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostSavedResponse> {
    return PostSavedResponse.of(await this.service.trash(actor, PostVersionRequest.from(id, body)));
  }

  @HttpCode(200)
  @Post(':id/restore')
  async restore(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostSavedResponse> {
    return PostSavedResponse.of(
      await this.service.recover(actor, PostVersionRequest.from(id, body)),
    );
  }
}
