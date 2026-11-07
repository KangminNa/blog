import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { NeighborsInput } from './graph.input';
import { GraphQuery } from './graph.query';
import type { NeighborsView } from './graph.view';

// MCP 도구 neighbors: 그래프의 점 하나와 이어진 점들을 읽는다. 볼 수 없는 점은 없는 점과 똑같이 답한다.
@Injectable()
export class NeighborsTool extends BaseTool {
  readonly name = 'neighbors';
  readonly scope = Actor.READ_PUBLIC;
  override readonly orScope = Actor.READ_ALL;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly description = [
    '그래프의 점 하나와 그 이웃을 읽는다. 점은 카테고리 · wiki · 세션 · 글이다.',
    'relation은 parent(이 점의 주소) · child(이 점에 놓인 점) · material(재료 세션) · link(wiki 사이 링크) · ref(글의 참고 wiki)다.',
    'node_id는 search_sessions, search_wikis의 결과나 이 도구의 이웃에서 얻는다.',
    '없거나 이 연결이 볼 수 없는 점이면 not_found가 오고, 볼 수 없는 이웃은 나오지 않는다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      node_id: { type: 'string', format: 'uuid', description: '점의 id' },
    },
    required: ['node_id'],
  };

  constructor(private readonly graph: GraphQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<NeighborsView> {
    return this.graph.neighbors(actor, NeighborsInput.from(raw));
  }
}
