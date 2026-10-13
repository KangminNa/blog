import { Controller, Get, Param, Query } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { ListSessionsRequest, ReadSessionRequest } from './read-session.request';
import { SessionQuery } from './session.query';
import {
  SessionDetailResponse,
  SessionListResponse,
  SessionRevisionResponse,
} from './session.response';

// 관리 화면의 세션 시트가 부르는 API. 저장은 MCP 도구(save_session)로만 들어온다.
@Controller('api/sessions')
export class SessionController {
  constructor(private readonly sessions: SessionQuery) {}

  /** 최근에 저장한 순서. ?project=로 거르고, 응답의 next를 ?cursor=로 보내면 다음 쪽 */
  @Get()
  async list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<SessionListResponse> {
    return SessionListResponse.of(await this.sessions.list(actor, ListSessionsRequest.from(query)));
  }

  @Get(':id')
  async get(
    @CurrentActor() actor: Actor,
    @Param() params: unknown,
  ): Promise<SessionDetailResponse> {
    return SessionDetailResponse.of(
      await this.sessions.get(actor, ReadSessionRequest.from(params)),
    );
  }

  @Get(':id/revisions/:seq')
  async revision(
    @CurrentActor() actor: Actor,
    @Param() params: unknown,
  ): Promise<SessionRevisionResponse> {
    return SessionRevisionResponse.of(
      await this.sessions.revisionOf(actor, ReadSessionRequest.from(params)),
    );
  }
}
