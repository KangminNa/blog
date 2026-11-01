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
