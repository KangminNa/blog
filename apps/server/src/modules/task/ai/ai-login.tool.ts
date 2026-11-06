import { Injectable } from '@nestjs/common';
import { Actor, BaseResponse, BaseTool } from '../../platform';
import { AiLoginInput, AiSigninStepInput } from './ai-login.input';
import { AiLoginService } from './ai-login.service';
import type { AiSigninRelayView, AiTokenView } from './ai-login.view';

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
// 토큰이 없을 때 러너는 일을 빌리지 않고 이것만 물으므로, 부를 때마다 러너가 닿은 때를 남긴다 (러너 메뉴의 연결 상태).
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

  constructor(private readonly logins: AiLoginService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<AiTokenResponse> {
    return AiTokenResponse.of(await this.logins.handOver(actor, AiLoginInput.from(raw)));
  }
}

/** ai_signin의 답 */
export class AiSigninRelayResponse extends BaseResponse {
  private constructor(private readonly view: AiSigninRelayView) {
    super();
  }

  static of(view: AiSigninRelayView): AiSigninRelayResponse {
    return new AiSigninRelayResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

// 웹 로그인을 진행하는 러너가 부른다 (run 권한, 그 작업의 임대를 쥔 러너만).
// 로그인 주소를 알리고, 사람이 붙여 넣은 코드를 받아 가고, 받은 자격을 넘긴다. 주소·코드·자격은 기록에 남지 않는다.
@Injectable()
export class AiSigninTool extends BaseTool {
  readonly name = 'ai_signin';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  override readonly idempotent = false;
  readonly description = [
    '웹 AI 로그인(작업 종류 ai_signin)을 서버와 잇는다. 러너가 로그인 명령을 PTY 안에서 돌리며 부른다.',
    'url(Codex는 user_code도): 화면에서 찾은 로그인 주소를 주인에게 보인다.',
    '아무 값 없이: 주인이 붙여 넣은 코드가 왔는지 묻는다 (Claude). 코드는 한 번만 온다.',
    'credential: 받은 자격(Claude 토큰 · Codex auth.json)을 저장하고 작업을 끝낸다.',
    '답의 cancelled가 true면 주인이 취소한 것이니 CLI를 끄고 끝낸다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid', description: '웹 로그인 작업 id' },
      url: { type: 'string', maxLength: 4096, description: '화면에서 찾은 로그인 주소' },
      user_code: { type: 'string', maxLength: 20, description: 'Codex가 보여 준 코드' },
      credential: { type: 'string', maxLength: 65536, description: '받은 자격' },
    },
    required: ['task_id'],
  };

  constructor(private readonly logins: AiLoginService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<AiSigninRelayResponse> {
    return AiSigninRelayResponse.of(
      await this.logins.relaySignin(actor, AiSigninStepInput.from(raw)),
    );
  }
}
