import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import type { Task } from '../task/task';
import type { AiLogin } from './ai-login';
import { AiTokenInput } from './ai-login.input';
import { AiLoginQuery } from './ai-login.query';
import { AiLoginService } from './ai-login.service';
import { AiTestView, type AiToolListView, AiToolView } from './ai-login.view';

/** 도구 목록. 토큰은 없다 */
export class AiToolListResponse extends BaseResponse {
  private constructor(private readonly view: AiToolListView) {
    super();
  }

  static of(view: AiToolListView): AiToolListResponse {
    return new AiToolListResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

/** 토큰을 넣은 뒤의 도구 하나. 토큰은 다시 보내지 않는다 */
export class AiToolResponse extends BaseResponse {
  private constructor(private readonly login: AiLogin) {
    super();
  }

  static of(login: AiLogin): AiToolResponse {
    return new AiToolResponse(login);
  }

  toJSON(): object {
    const l = this.login;
    return new AiToolView(
      l.tool,
      l.usableAt(new Date()),
      l.expiresAt,
      l.checkedAt,
      l.lastError,
    ).toJSON();
  }
}

/** 맡긴 연결 확인 */
export class AiTestResponse extends BaseResponse {
  private constructor(private readonly task: Task) {
    super();
  }

  static of(task: Task): AiTestResponse {
    return new AiTestResponse(task);
  }

  toJSON(): object {
    return new AiTestView(this.task.id, this.task.status).toJSON();
  }
}

// AI 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/ai')
export class AiLoginController {
  constructor(
    private readonly logins: AiLoginQuery,
    private readonly service: AiLoginService,
  ) {}

  @Get()
  async list(@CurrentActor() actor: Actor): Promise<AiToolListResponse> {
    return AiToolListResponse.of(await this.logins.list(actor));
  }

  @Put('claude/token')
  async saveToken(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<AiToolResponse> {
    return AiToolResponse.of(await this.service.saveToken(actor, AiTokenInput.from(body)));
  }

  @HttpCode(200)
  @Post('claude/test')
  async test(@CurrentActor() actor: Actor): Promise<AiTestResponse> {
    return AiTestResponse.of(await this.service.test(actor));
  }
}
