import { Injectable } from '@nestjs/common';
import { Actor, BaseResponse, BaseTool } from '../../platform';
import { AiLoginInput } from './ai-login.input';
import { AiLoginQuery } from './ai-login.query';
import type { AiTokenView } from './ai-login.view';

/** ai_login의 답 */
export class AiTokenResponse extends BaseResponse {
  private constructor(private readonly view: AiTokenView) {
    super();
  }

  static of(view: AiTokenView): AiTokenResponse {
    return new AiTokenResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

// 러너가 일마다 부른다 (run 권한). 받은 토큰은 메모리에만 두고 AI CLI를 띄울 때 환경 변수로만 넘긴다.
@Injectable()
export class AiLoginTool extends BaseTool {
  readonly name = 'ai_login';
  readonly scope = Actor.RUN;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly description = [
    '콘솔에 넣은 AI 토큰을 받는다. 서버 러너가 일마다 부른다.',
    '토큰은 메모리에만 두고 AI CLI를 띄울 때 환경 변수로만 넘긴다. 저장하거나 기록에 남기지 않는다.',
    '토큰이 없거나 만료됐으면 오류가 온다. 그때는 일을 release_job으로 돌려준다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      tool: { type: 'string', maxLength: 40, description: 'AI 도구 이름 (claude)' },
    },
    required: ['tool'],
  };

  constructor(private readonly logins: AiLoginQuery) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<AiTokenResponse> {
    return AiTokenResponse.of(await this.logins.token(actor, AiLoginInput.from(raw)));
  }
}
