import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { SearchWikisInput, WikiIdInput } from './wiki.input';
import { WikiQuery } from './wiki.query';
import type { ToolWikiView, WikiHitPageView } from './wiki.view';

// MCP 도구 search_wikis: 정리된 wiki를 키워드로 찾는다. 요청자가 볼 수 있는 wiki만 나온다.
@Injectable()
export class SearchWikisTool extends BaseTool {
  readonly name = 'search_wikis';
  readonly scope = Actor.READ_PUBLIC;
  override readonly orScope = Actor.READ_ALL;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      query: {
        type: 'string',
        maxLength: SearchWikisInput.QUERY_MAX,
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: SearchWikisInput.LIMIT_MAX,
        default: SearchWikisInput.LIMIT_DEFAULT,
      },
      cursor: { type: 'string', maxLength: 100 },
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
  readonly inputSchema = {
    properties: {
      wiki_id: { type: 'string', format: 'uuid' },
    },
    required: ['wiki_id'],
  };

  constructor(private readonly wikis: WikiQuery) {
    super();
  }

  /** 읽기 권한이 없어도 이 작업에 읽기를 허락받은 wiki가 있으면 연다 (만들기 작업의 재료). 그 wiki만 읽힌다 */
  override allows(actor: Actor): boolean {
    return super.allows(actor) || actor.hasReadGrants();
  }

  handle(actor: Actor, raw: unknown): Promise<ToolWikiView> {
    return this.wikis.note(actor, WikiIdInput.fromTool(raw));
  }
}
