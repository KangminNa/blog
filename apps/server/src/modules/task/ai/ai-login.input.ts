import { BaseRequest } from '../../platform';

// AI 로그인 입력의 모양. 오류 문구에 토큰 값을 넣지 않는다.

/** PUT /api/ai/claude/token. 터미널에서 줄이 접힌 채 복사하면 토큰이 끊기므로 공백을 따로 알린다 */
export class AiTokenInput extends BaseRequest {
  private static readonly PREFIX = 'sk-ant-oat';
  private static readonly TOKEN_MAX = 2_000;

  private constructor(readonly token: string) {
    super();
  }

  static from(raw: unknown): AiTokenInput {
    return BaseRequest.read(raw, (f) => {
      const token = f.text('token', AiTokenInput.TOKEN_MAX);
      if (/\s/.test(token))
        f.reject(
          'token',
          '공백이나 줄바꿈이 섞인 토큰이에요. 끊긴 곳 없이 한 줄로 붙여 넣어 주세요',
        );
      else if (token && !token.startsWith(AiTokenInput.PREFIX))
        f.reject('token', `${AiTokenInput.PREFIX}로 시작하지 않는 토큰이에요`);
      return new AiTokenInput(token);
    });
  }
}

/** ai_login */
export class AiLoginInput extends BaseRequest {
  private constructor(readonly tool: string) {
    super();
  }

  static from(raw: unknown): AiLoginInput {
    return BaseRequest.read(raw, (f) => new AiLoginInput(f.text('tool', 40)));
  }
}

/** POST /api/ai/:tool/signin. 도구 이름의 뜻은 AiLogin이 검사한다 */
export class AiSigninInput extends BaseRequest {
  private constructor(readonly tool: string) {
    super();
  }

  static from(tool: string): AiSigninInput {
    return BaseRequest.read({ tool }, (f) => new AiSigninInput(f.text('tool', 40)));
  }
}

/** POST /api/ai/claude/signin/code: 주인이 브라우저에서 받은 코드. 오류 문구에 코드를 넣지 않는다 */
export class AiSigninCodeInput extends BaseRequest {
  private constructor(
    readonly taskId: string,
    readonly code: string,
  ) {
    super();
  }

  static from(raw: unknown): AiSigninCodeInput {
    return BaseRequest.read(
      raw,
      (f) => new AiSigninCodeInput(f.uuid('taskId'), f.text('code', 1024).trim()),
    );
  }
}

/**
 * ai_signin (러너). 로그인 주소를 찾았으면 url(+ Codex는 user_code), 자격을 받았으면 credential.
 * 아무것도 없이 부르면 사람이 붙여 넣은 코드가 왔는지 묻는 것이다
 */
export class AiSigninStepInput extends BaseRequest {
  private static readonly CREDENTIAL_MAX = 64 * 1024;

  private constructor(
    readonly taskId: string,
    readonly url: string | null,
    readonly userCode: string | null,
    readonly credential: string | null,
  ) {
    super();
  }

  static from(raw: unknown): AiSigninStepInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new AiSigninStepInput(
          f.uuid('task_id'),
          f.optionalText('url', 4096),
          f.optionalText('user_code', 20),
          f.optionalText('credential', AiSigninStepInput.CREDENTIAL_MAX),
        ),
    );
  }
}

/**
 * ai_login_refresh (러너). 실행하는 동안 CLI가 갱신한 자격을 되돌려 쓴다.
 * 받은 판(version)과 그 일을 함께 보낸다: 판이 다르면 다른 실행이 먼저 바꾼 것이라 덮지 않는다
 */
export class AiLoginRefreshInput extends BaseRequest {
  private static readonly CREDENTIAL_MAX = 64 * 1024;

  private constructor(
    readonly taskId: string,
    readonly tool: string,
    readonly version: number,
    readonly credential: string,
  ) {
    super();
  }

  static from(raw: unknown): AiLoginRefreshInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new AiLoginRefreshInput(
          f.uuid('task_id'),
          f.text('tool', 40),
          f.integer('version', 1, 2_147_483_647),
          f.text('credential', AiLoginRefreshInput.CREDENTIAL_MAX),
        ),
    );
  }
}
