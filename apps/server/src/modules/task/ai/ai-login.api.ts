import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { AiTokenInput } from './ai-login.input';
import { AiLoginQuery } from './ai-login.query';
import { AiLoginService } from './ai-login.service';
import type { AiTestView, AiToolListView, AiToolView } from './ai-login.view';

// AI 메뉴. 주인만 (Service·Query 첫 줄에서 확인). 토큰은 다시 보내지 않는다.
@Controller('api/ai')
export class AiLoginController {
  constructor(
    private readonly logins: AiLoginQuery,
    private readonly service: AiLoginService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<AiToolListView> {
    return this.logins.list(actor);
  }

  @Put('claude/token')
  async saveToken(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<AiToolView> {
    return (await this.service.saveToken(actor, AiTokenInput.from(body))).view(new Date());
  }

  @HttpCode(200)
  @Post('claude/test')
  async test(@CurrentActor() actor: Actor): Promise<AiTestView> {
    return (await this.service.test(actor)).testView();
  }
}
