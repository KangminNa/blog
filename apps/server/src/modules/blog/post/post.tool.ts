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
  readonly description = [
    '글 하나의 제목, 본문 md, 공개 범위, 버전, 태그, 대표 wiki(main_wiki_id)와 참고 wiki(ref_wiki_ids)를 읽는다.',
    'wiki는 이 연결이 볼 수 있는 것만 나온다.',
    '초안을 고치기 전에 불러서 version을 받고, blog_save_draft의 base_version에 그대로 넣는다.',
    '휴지통에 있는 글은 없는 글과 같다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      post_id: { type: 'string', format: 'uuid', description: '글 id' },
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
  readonly description = [
    '블로그 글을 초안으로 저장한다. post_id가 없으면 새 초안을 만들고, 있으면 그 초안을 고친다.',
    '고칠 때는 blog_get_post로 받은 version을 base_version에 넣는다. 그사이 바뀌었으면 409가 오니 다시 읽고 고친다.',
    '공개된 글은 고칠 수 없고(403), 공개 범위도 정할 수 없다. 공개는 주인의 결재를 받는다.',
    'main_wiki_id와 ref_wiki_ids는 글을 그래프의 wiki에 잇는다. 보내지 않으면 그대로다.',
    '없거나 이 연결이 볼 수 없는 wiki면 not_found가 온다.',
    '응답을 받지 못해 다시 보낼 때는 같은 request_id를 쓴다. 응답의 url을 사용자에게 보여 준다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      request_id: {
        type: 'string',
        maxLength: 200,
        description: '이 저장의 id. 다시 보낼 때 같은 값을 쓰면 한 번만 저장된다',
      },
      post_id: { type: 'string', format: 'uuid', description: '고칠 글 id. 새 초안이면 비운다' },
      base_version: {
        type: 'integer',
        minimum: 1,
        description: '고칠 글을 읽을 때의 version. post_id가 있으면 꼭 넣는다',
      },
      title: { type: 'string', maxLength: PostContent.TITLE_MAX, description: '제목' },
      body_md: { type: 'string', maxLength: PostContent.BODY_MAX, description: '본문 md' },
      tags: {
        type: 'array',
        items: { type: 'string', maxLength: 40 },
        maxItems: 20,
        description: '태그. 고칠 때 비우면 지금 태그 그대로',
      },
      main_wiki_id: {
        type: ['string', 'null'],
        format: 'uuid',
        description: '대표 wiki id. 글이 그래프에서 이 wiki 아래에 놓인다. null이면 비운다',
      },
      ref_wiki_ids: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        maxItems: Post.REFS_MAX,
        description:
          '참고 wiki id. 보낸 목록으로 바뀌고 빈 목록이면 비운다. 대표와 같은 id는 빠진다',
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
