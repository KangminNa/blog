import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { SearchWikisInput, WikiIdInput } from './wiki.input';
import { WikiQuery } from './wiki.query';
import type { WikiHitPageView, WikiNoteView } from './wiki.view';

// MCP 도구 search_wikis: 정리된 wiki를 키워드로 찾는다. 요청자가 볼 수 있는 wiki만 나온다.
@Injectable()
export class SearchWikisTool extends BaseTool {
  readonly name = 'search_wikis';
  readonly scope = Actor.READ_PUBLIC;
  override readonly orScope = Actor.READ_ALL;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly description = [
    '정리된 wiki를 키워드로 찾는다. 제목과 본문에서 찾고, 한국어도 된다.',
    '띄어 쓴 단어가 모두 들어 있는 wiki만 찾는다. 대소문자를 구분하니 없으면 표기를 바꿔 다시 찾는다.',
    '결과는 최근에 만든 wiki부터 나온다. next가 있으면 cursor에 그대로 넣어 다음 쪽을 부른다.',
    '이 연결이 볼 수 있는 wiki만 나온다. 내용 전체는 wiki_id로 get_wiki를 불러 읽는다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      query: {
        type: 'string',
        maxLength: SearchWikisInput.QUERY_MAX,
        description: '찾을 말. 본문에 그대로 있을 말이 잘 찾아진다',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: SearchWikisInput.LIMIT_MAX,
        default: SearchWikisInput.LIMIT_DEFAULT,
        description: '한 쪽에 받을 wiki 수',
      },
      cursor: { type: 'string', maxLength: 100, description: '앞 응답의 next 값 그대로' },
    },
    required: ['query'],
  };

  constructor(private readonly wikis: WikiQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<WikiHitPageView> {
    return this.wikis.search(actor, SearchWikisInput.from(raw));
  }
}

// MCP 도구 get_wiki: wiki 하나의 지금 판을 읽는다. 볼 수 없는 wiki는 없는 wiki와 똑같이 답한다.
@Injectable()
export class GetWikiTool extends BaseTool {
  readonly name = 'get_wiki';
  readonly scope = Actor.READ_PUBLIC;
  override readonly orScope = Actor.READ_ALL;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly description = [
    'wiki 하나의 지금 판을 읽는다. 제목, 카테고리, version, 판 번호, 칸(## 제목 단위), 본문 md를 준다.',
    'version은 고칠 때 submit_changes의 base_version으로 쓴다.',
    'pinned_sections는 사람이 고친 칸이다. 이 칸을 바꾸면 바로 합쳐지지 않고 검토로 간다.',
    'wiki_id는 search_wikis의 결과에서 얻는다. 없거나 이 연결이 볼 수 없는 wiki면 not_found가 온다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      wiki_id: { type: 'string', format: 'uuid', description: '읽을 wiki의 id' },
    },
    required: ['wiki_id'],
  };

  constructor(private readonly wikis: WikiQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<WikiNoteView> {
    return this.wikis.note(actor, WikiIdInput.fromTool(raw));
  }
}
