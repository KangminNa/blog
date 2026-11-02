import { Controller, Get, Param, Query } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { ListSessionsInput, ReadSessionInput } from './session.input';
import { SessionQuery } from './session.query';
import type { SessionDetailView, SessionPageView, SessionRevisionView } from './session.view';

// 관리 화면의 세션 시트가 부르는 API. 저장은 MCP 도구(save_session)로만 들어온다.
@Controller('api/sessions')
export class SessionController {
  constructor(private readonly sessions: SessionQuery) {}

  /** 최근에 저장한 순서. ?project=로 거르고, 응답의 next를 ?cursor=로 보내면 다음 쪽 */
  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<SessionPageView> {
    return this.sessions.list(actor, ListSessionsInput.from(query));
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param() params: unknown): Promise<SessionDetailView> {
    return this.sessions.get(actor, ReadSessionInput.from(params));
  }

  @Get(':id/revisions/:seq')
  revision(@CurrentActor() actor: Actor, @Param() params: unknown): Promise<SessionRevisionView> {
    return this.sessions.revisionOf(actor, ReadSessionInput.from(params));
  }
}
