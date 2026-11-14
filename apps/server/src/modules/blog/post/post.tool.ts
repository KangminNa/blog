import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { Post } from './post';
import { ReadPostInput, SaveDraftInput } from './post.input';
import { PostQuery } from './post.query';
import { PostService } from './post.service';
import type { ToolDraftView, ToolPostView } from './post.view';
import { PostContent } from './post-content';

// AI 도구의 글 쓰기 (write 권한). 기기와 에이전트의 작업 토큰이 같은 도구를 쓴다.
// 초안까지만 쓴다. 공개와 공개된 글 고치기는 주인의 일이다 (Post가 막는다).
// 입력 모양을 바꾸면 스킬을 함께 고친다. 깨지는 변경은 새 도구 이름으로 (API설계 2장).
@Injectable()
export class BlogGetPostTool extends BaseTool {
  readonly name = 'blog_get_post';
  readonly scope = Actor.WRITE;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      post_id: { type: 'string', format: 'uuid' },
    },
    required: ['post_id'],
  };

  constructor(private readonly posts: PostQuery) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<ToolPostView> {
    return this.posts.editable(actor, ReadPostInput.fromTool(raw));
  }
}

@Injectable()
export class BlogSaveDraftTool extends BaseTool {
  readonly name = 'blog_save_draft';
  readonly scope = Actor.WRITE;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      request_id: {
        type: 'string',
        maxLength: 200,
      },
      post_id: { type: 'string', format: 'uuid' },
      base_version: {
        type: 'integer',
        minimum: 1,
      },
      title: { type: 'string', maxLength: PostContent.TITLE_MAX },
      body_md: { type: 'string', maxLength: PostContent.BODY_MAX },
      tags: {
        type: 'array',
        items: { type: 'string', maxLength: 40 },
        maxItems: 20,
      },
      main_wiki_id: {
        type: ['string', 'null'],
        format: 'uuid',
      },
      ref_wiki_ids: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        maxItems: Post.REFS_MAX,
      },
    },
    required: ['request_id', 'title', 'body_md'],
  };

  constructor(private readonly posts: PostService) {
    super();
  }

  async handle(actor: Actor, raw: unknown, site: string): Promise<ToolDraftView> {
    return (await this.posts.saveDraft(actor, SaveDraftInput.from(raw))).draftView(site);
  }
}
