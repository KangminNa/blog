import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { GithubLogin } from './github-login';
import { GithubLoginGateway } from './github-login.gateway';

// GitHub 로그인: 로그인 화면에 "GitHub로 로그인" 버튼을 더한다.
// Client ID·secret이 비어 있으면 등록하지 않는다 (버튼이 나오지 않음).
export default class LoginGithubPlugin extends BasePlugin {
  register(cairn: PluginContext): void {
    const settings = cairn.settings();
    const clientId = settings.get('clientId') ?? '';
    const clientSecret = settings.get('clientSecret') ?? '';
    if (!clientId || !clientSecret) return;
    const gateway = new GithubLoginGateway(
      clientId,
      clientSecret,
      (settings.get('githubUrl') || 'https://github.com').replace(/\/+$/, ''),
      (settings.get('apiUrl') || 'https://api.github.com').replace(/\/+$/, ''),
    );
    cairn.addLogin('github', new GithubLogin(gateway));
  }
}
