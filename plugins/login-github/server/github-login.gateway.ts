import { BaseGateway, ExternalFailure, RuleViolation } from '../../../apps/server/src/plugin-api';

/** GitHub `/user` 응답에서 쓰는 것. 기준은 숫자 id다 (login 이름은 바뀔 수 있음) */
export class GithubAccount {
  private constructor(
    readonly id: number,
    readonly login: string,
  ) {}

  static read(json: unknown): GithubAccount {
    const body = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
    if (typeof body.id !== 'number' || typeof body.login !== 'string')
      throw new ExternalFailure('GitHub 사용자 정보의 모양이 예상과 달라요');
    return new GithubAccount(body.id, body.login);
  }
}

// GitHub OAuth 로그인 (웹 흐름). 라이브러리 없이 요청 세 번: 보내기 주소 → 코드를 토큰으로 → 사용자 정보.
// 권한(scope)은 요청하지 않는다. 공개 프로필만 읽으면 되므로.
export class GithubLoginGateway extends BaseGateway {
  protected readonly name = 'GitHub 로그인';

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly githubUrl: string,
    private readonly apiUrl: string,
  ) {
    super();
  }

  authorizeUrl(callbackUrl: string, state: string): string {
    const query = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: callbackUrl,
      state,
      allow_signup: 'false',
    });
    return `${this.githubUrl}/login/oauth/authorize?${query}`;
  }

  /** GitHub가 돌려준 코드를 접근 토큰으로. 코드가 틀렸거나 만료됐으면 RuleViolation */
  async exchange(code: string, callbackUrl: string): Promise<string> {
    const body = await this.call(async (signal) => {
      const res = await fetch(`${this.githubUrl}/login/oauth/access_token`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: callbackUrl,
        }),
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    });
    if (typeof body.access_token !== 'string') {
      const reason = typeof body.error_description === 'string' ? body.error_description : '';
      throw new RuleViolation(`GitHub 로그인이 끝나지 않았어요. 다시 해 주세요 (${reason})`);
    }
    return body.access_token;
  }

  async account(token: string): Promise<GithubAccount> {
    const json = await this.call(async (signal) => {
      const res = await fetch(`${this.apiUrl}/user`, {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    return GithubAccount.read(json);
  }
}
