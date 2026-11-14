import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { AiLoginInput, AiLoginRefreshInput, AiSigninStepInput } from './ai-login.input';
import { AiLoginService } from './ai-login.service';
import type { AiLoginVersionView, AiSigninRelayView, AiTokenView } from './ai-login.view';

// 러너가 일마다 부른다 (run 권한). 받은 토큰은 메모리에만 두고 AI CLI를 띄울 때 환경 변수로만 넘긴다.
// 부를 때마다 러너가 닿은 때를 남긴다 (러너 메뉴의 연결 상태): 할 수 있는 것을 알리기 전의 러너는 토큰이 없으면 이것만 묻는다.
@Injectable()
export class AiLoginTool extends BaseTool {
  readonly name = 'ai_login';
  readonly scope = Actor.RUN;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      tool: { type: 'string', maxLength: 40 },
    },
    required: ['tool'],
  };

  constructor(private readonly logins: AiLoginService) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<AiTokenView> {
    return this.logins.handOver(actor, AiLoginInput.from(raw));
  }
}

// 실행하는 동안 CLI가 갱신한 자격(Codex의 auth.json)을 되돌려 쓴다. 갱신 토큰은 한 번 쓰면 바뀌어서,
// 되돌려 쓰지 않으면 다음 실행이 옛 갱신 토큰을 내밀어 로그인이 깨진다.
@Injectable()
export class AiLoginRefreshTool extends BaseTool {
  readonly name = 'ai_login_refresh';
  readonly scope = Actor.RUN;
  readonly readOnly = false;
  override readonly idempotent = false;
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      tool: { type: 'string', maxLength: 40 },
      version: { type: 'integer', minimum: 1 },
      credential: { type: 'string', maxLength: 65536 },
    },
    required: ['task_id', 'tool', 'version', 'credential'],
  };

  constructor(private readonly logins: AiLoginService) {
    super();
  }

  /** 저장한 뒤의 판 */
  async handle(actor: Actor, raw: unknown): Promise<AiLoginVersionView> {
    return (await this.logins.refresh(actor, AiLoginRefreshInput.from(raw))).versionView();
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
  readonly inputSchema = {
    properties: {
      task_id: { type: 'string', format: 'uuid' },
      url: { type: 'string', maxLength: 4096 },
      user_code: { type: 'string', maxLength: 20 },
      credential: { type: 'string', maxLength: 65536 },
    },
    required: ['task_id'],
  };

  constructor(private readonly logins: AiLoginService) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<AiSigninRelayView> {
    return this.logins.relaySignin(actor, AiSigninStepInput.from(raw));
  }
}
