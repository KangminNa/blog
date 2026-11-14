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
  readonly inputSchema = {
    properties: {
      node_id: { type: 'string', format: 'uuid' },
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
