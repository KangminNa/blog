import { BaseLogin, LoginIdentity, RuleViolation } from '../../../apps/server/src/plugin-api';
import type { GithubLoginGateway } from './github-login.gateway';

// GitHub로 로그인. 누구인지(GitHub 숫자 id와 login 이름)만 코어에 알려준다.
// 주인인지는 코어가 정한다: 주인이 계정 시트에서 먼저 연결해 둔 GitHub 계정만 로그인된다.
export class GithubLogin extends BaseLogin {
  readonly label = 'GitHub로 로그인';

  constructor(private readonly github: GithubLoginGateway) {
    super();
  }

  start(callbackUrl: string, state: string): string {
    return this.github.authorizeUrl(callbackUrl, state);
  }

  async finish(query: ReadonlyMap<string, string>, callbackUrl: string): Promise<LoginIdentity> {
    const code = query.get('code');
    if (!code) {
      // 사용자가 GitHub 화면에서 "취소"를 누르면 error=access_denied로 돌아온다
      const reason = query.get('error_description') ?? query.get('error') ?? '코드가 없어요';
      throw new RuleViolation(`GitHub 로그인을 끝내지 못했어요 (${reason})`);
    }
    const account = await this.github.account(await this.github.exchange(code, callbackUrl));
    return new LoginIdentity(String(account.id), account.login);
  }
}
