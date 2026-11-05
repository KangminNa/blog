import { Controller, Get, Param, Query } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import { ListSessionsInput, ReadSessionInput } from './session.input';
import { SessionQuery } from './session.query';
import type { SessionDetailView, SessionPageView, SessionRevisionView } from './session.view';

/** 관리 화면의 세션 목록 한 쪽 */
export class SessionListResponse extends BaseResponse {
  private constructor(private readonly page: SessionPageView) {
    super();
  }

  static of(page: SessionPageView): SessionListResponse {
    return new SessionListResponse(page);
  }

  toJSON(): object {
    return this.page.toJSON();
  }
}

/** 관리 화면의 세션 하나: 지금 판 + 판 기록 */
export class SessionDetailResponse extends BaseResponse {
  private constructor(private readonly view: SessionDetailView) {
    super();
  }

  static of(view: SessionDetailView): SessionDetailResponse {
    return new SessionDetailResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

/** 판 하나 (지난 판 보기) */
export class SessionRevisionResponse extends BaseResponse {
  private constructor(private readonly view: SessionRevisionView) {
    super();
  }

  static of(view: SessionRevisionView): SessionRevisionResponse {
    return new SessionRevisionResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

// 관리 화면의 세션 시트가 부르는 API. 저장은 MCP 도구(save_session)로만 들어온다.
@Controller('api/sessions')
export class SessionController {
  constructor(private readonly sessions: SessionQuery) {}

  /** 최근에 저장한 순서. ?project=로 거르고, 응답의 next를 ?cursor=로 보내면 다음 쪽 */
  @Get()
  async list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<SessionListResponse> {
    return SessionListResponse.of(await this.sessions.list(actor, ListSessionsInput.from(query)));
  }

  @Get(':id')
  async get(
    @CurrentActor() actor: Actor,
    @Param() params: unknown,
  ): Promise<SessionDetailResponse> {
    return SessionDetailResponse.of(await this.sessions.get(actor, ReadSessionInput.from(params)));
  }

  @Get(':id/revisions/:seq')
  async revision(
    @CurrentActor() actor: Actor,
    @Param() params: unknown,
  ): Promise<SessionRevisionResponse> {
    return SessionRevisionResponse.of(
      await this.sessions.revisionOf(actor, ReadSessionInput.from(params)),
    );
  }
}
