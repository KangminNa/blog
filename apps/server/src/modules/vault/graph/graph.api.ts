import { Controller, Get } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import { GraphQuery } from './graph.query';
import type { GraphView } from './graph.view';

/** 그래프 { nodes, edges } */
export class GraphResponse extends BaseResponse {
  private constructor(private readonly graph: GraphView) {
    super();
  }

  static of(graph: GraphView): GraphResponse {
    return new GraphResponse(graph);
  }

  toJSON(): object {
    return this.graph.toJSON();
  }
}

// 그래프. 주인의 전체 그래프와 방문자의 공개 그래프는 경로가 다르고, 거르는 일은 서버의 Query가 한다.
@Controller('api/graph')
export class GraphController {
  constructor(private readonly graph: GraphQuery) {}

  @Get()
  async owner(@CurrentActor() actor: Actor): Promise<GraphResponse> {
    return GraphResponse.of(await this.graph.owner(actor));
  }

  @Get('public')
  async visitors(@CurrentActor() actor: Actor): Promise<GraphResponse> {
    return GraphResponse.of(await this.graph.visitors(actor));
  }
}
