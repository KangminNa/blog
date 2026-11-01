import { BaseRequest } from '../../platform';

/** MCP `neighbors`. 점의 id를 받는다 (카테고리 · wiki · 세션 · 글) */
export class NeighborsInput extends BaseRequest {
  private constructor(readonly nodeId: string) {
    super();
  }

  static from(raw: unknown): NeighborsInput {
    return BaseRequest.read(raw, (f) => new NeighborsInput(f.uuid('node_id')));
  }
}
