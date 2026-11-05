import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import type { Post as PostEntity } from './post';
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
import { type PostPageView, type PostView, SavedPostView } from './post.view';

/** 글 목록 한 쪽. 방문자에게는 읽을 것만, 주인에게는 공개 범위·판 수·탭별 글 수까지 */
export class PostListResponse extends BaseResponse {
  private constructor(private readonly page: PostPageView) {
    super();
  }

  static of(page: PostPageView): PostListResponse {
    return new PostListResponse(page);
  }

  toJSON(): object {
    // 탭별 글 수는 비공개 글까지 보는 사람(주인)에게만 있다
    return this.page.counts !== null ? this.page.toJSON() : this.page.toPublicJSON();
  }
}

/** 글 하나 (방문자의 글 페이지, 주인의 미리 보기·편집기) */
export class PostResponse extends BaseResponse {
  private constructor(private readonly view: PostView) {
    super();
  }

  static of(view: PostView): PostResponse {
    return new PostResponse(view);
  }

  toJSON(): object {
    return this.view.owner ? this.view.toJSON() : this.view.toPublicJSON();
  }
}

/** 쓰기 결과 (편집기에게). revised: 이번 저장으로 새 판이 쌓였는가. wiki 연결은 비공개까지 보는 요청자에게만 */
export class PostSavedResponse extends BaseResponse {
  private constructor(
    private readonly view: SavedPostView,
    private readonly full: boolean,
  ) {
    super();
  }

  static of(p: PostEntity, actor: Actor): PostSavedResponse {
    return new PostSavedResponse(
      new SavedPostView(
        p.id,
        p.slug,
        p.content.title,
        p.content.body,
        p.content.excerpt,
        p.tags,
        // 엔티티가 Post.ALIGNS · Post.STATUSES만 받는다 (DB의 CHECK도)
        p.align as SavedPostView['align'],
        p.status as SavedPostView['status'],
        p.version,
        p.revisionCount,
        p.addedRevision !== null,
        p.publishedAt,
        p.updatedAt,
        p.deletedAt,
        p.mainWikiId,
        p.refWikiIds,
      ),
      actor.canSeePrivate(),
    );
  }

  toJSON(): object {
    return this.full ? this.view.toJSON() : this.view.toJSONWithoutWikis();
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
  async list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<PostListResponse> {
    return PostListResponse.of(await this.posts.list(actor, ListPostsInput.from(query)));
  }

  @Get('by-slug/:slug')
  async bySlug(@CurrentActor() actor: Actor, @Param('slug') slug: string): Promise<PostResponse> {
    return PostResponse.of(await this.posts.bySlug(actor, PostSlugInput.from(slug)));
  }

  @Get(':id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<PostResponse> {
    return PostResponse.of(await this.posts.get(actor, ReadPostInput.from(id)));
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<PostSavedResponse> {
    return PostSavedResponse.of(
      await this.service.create(actor, CreatePostInput.from(body)),
      actor,
    );
  }

  @Put(':id')
  async save(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostSavedResponse> {
    return PostSavedResponse.of(
      await this.service.save(actor, SavePostInput.from(id, body)),
      actor,
    );
  }

  @HttpCode(200)
  @Post(':id/status')
  async status(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostSavedResponse> {
    return PostSavedResponse.of(
      await this.service.changeStatus(actor, PostStatusInput.from(id, body)),
      actor,
    );
  }

  @Delete(':id')
  async trash(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostSavedResponse> {
    return PostSavedResponse.of(
      await this.service.trash(actor, PostVersionInput.from(id, body)),
      actor,
    );
  }

  @HttpCode(200)
  @Post(':id/restore')
  async restore(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PostSavedResponse> {
    return PostSavedResponse.of(
      await this.service.recover(actor, PostVersionInput.from(id, body)),
      actor,
    );
  }
}
