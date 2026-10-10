import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { RuleViolation } from '../../../apps/server/src/plugin-api';
import { FakeGithub } from './fake-github';
import { GithubLogin } from './github-login';
import { GithubLoginGateway } from './github-login.gateway';

// 가짜 GitHub로 로그인 방법의 약속을 확인한다: 보낼 주소에 state·돌아올 주소가 붙고,
// 돌아온 코드로 GitHub 숫자 id와 login 이름을 알려주며, 취소·틀린 코드는 RuleViolation.

let fake: FakeGithub;
let login: GithubLogin;
const CALLBACK = 'https://blog.example.com/api/auth/login/github/callback';

before(async () => {
  fake = await FakeGithub.start();
  login = new GithubLogin(new GithubLoginGateway('client-1', 'secret-1', fake.url, fake.url));
});
after(() => fake.close());

describe('login-github', () => {
  test('보낼 주소: 우리 앱 id, 돌아올 주소, state를 붙이고 권한은 요청하지 않는다', () => {
    const url = new URL(login.start(CALLBACK, 'state-123'));
    assert.equal(`${url.origin}${url.pathname}`, `${fake.url}/login/oauth/authorize`);
    assert.equal(url.searchParams.get('client_id'), 'client-1');
    assert.equal(url.searchParams.get('redirect_uri'), CALLBACK);
    assert.equal(url.searchParams.get('state'), 'state-123');
    assert.equal(url.searchParams.get('scope'), null);
  });

  test('돌아온 코드로 GitHub 숫자 id와 login 이름을 알려준다', async () => {
    const identity = await login.finish(new Map([['code', 'ok-4242']]), CALLBACK);
    assert.equal(identity.subject, '4242');
    assert.equal(identity.label, 'user4242');
  });

  test('취소했거나 코드가 틀리면 RuleViolation', async () => {
    await assert.rejects(
      login.finish(new Map([['error', 'access_denied']]), CALLBACK),
      RuleViolation,
    );
    await assert.rejects(login.finish(new Map([['code', 'bad']]), CALLBACK), RuleViolation);
  });
});
