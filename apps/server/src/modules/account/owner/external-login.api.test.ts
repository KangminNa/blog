import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { FakeGithub } from '../../../testing/fake-github';

// 외부 로그인 (확장 지점 login:<이름>, 플러그인 login-github). 가짜 GitHub로 끝까지 돌린다.
//   연결 전에는 GitHub로 로그인되지 않는다 → 주인이 계정 시트에서 연결 → 그 계정으로만 로그인 → 끊으면 다시 안 됨.

let api: ApiClient;
let github: FakeGithub;
let owner: TestUser;
const OWNER_GITHUB = 1001;

/** 시작 → 가짜 GitHub 코드 → 돌아오기. 돌아온 응답(302)을 그대로 돌려준다 */
async function roundTrip(start: string, githubId: number, who: TestUser): Promise<ApiResult> {
  const begin = await api.get(start, who);
  assert.equal(begin.status, 302, begin.text);
  const state = new URL(begin.location ?? '').searchParams.get('state') ?? '';
  return api.get(
    `/api/auth/login/github/callback?code=ok-${githubId}&state=${encodeURIComponent(state)}`,
    who.with(begin.cookies()),
  );
}

function errorOf(res: ApiResult): string | null {
  return new URL(res.location ?? '', 'http://x').searchParams.get('error');
}

before(async () => {
  api = await ApiClient.start();
  github = await FakeGithub.start();
  owner = await api.signIn();
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  await api.request('POST', '/api/plugins/login-github/enable', owner);
  const saved = await api.request('PUT', '/api/plugins/login-github/settings', owner, {
    values: {
      clientId: 'client-1',
      clientSecret: 'secret-1',
      githubUrl: github.url,
      apiUrl: github.url,
    },
  });
  assert.equal(saved.status, 200, saved.text);
});
after(async () => {
  await api.request('DELETE', '/api/auth/links/github', owner);
  await api.request('POST', '/api/plugins/login-github/disable', owner);
  await api.close();
  await github.close();
});

describe('로그인 방법', () => {
  test('켜진 로그인 플러그인이 로그인 화면의 버튼이 된다', async () => {
    assert.deepEqual((await api.get('/api/auth/methods')).json(), {
      methods: [{ method: 'github', label: 'GitHub로 로그인' }],
    });
  });

  test('보낼 주소는 가짜 GitHub, 돌아올 주소는 사이트 주소 아래', async () => {
    const begin = await api.get('/api/auth/login/github/start');
    const url = new URL(begin.location ?? '');
    assert.equal(url.origin, github.url);
    assert.equal(
      url.searchParams.get('redirect_uri'),
      `${api.baseUrl}/api/auth/login/github/callback`,
    );
  });

  test('연결하기 전에는 GitHub로 로그인되지 않는다 (로그인 화면으로 돌려보내며 이유)', async () => {
    const res = await roundTrip('/api/auth/login/github/start', OWNER_GITHUB, TestUser.visitor);
    assert.equal(res.status, 302);
    assert.equal(new URL(res.location ?? '', 'http://x').pathname, '/login');
    assert.match(errorOf(res) ?? '', /연결하지 않은 계정이에요/);
    assert.equal(res.cookies().cairn_session, undefined);
  });
});

describe('계정 연결', () => {
  test('방문자는 연결을 시작할 수 없다 (403)', async () => {
    assert.equal((await api.get('/api/auth/links/github/start')).status, 403);
  });

  test('주인이 연결하면 계정 시트에 GitHub login 이름이 보인다', async () => {
    const res = await roundTrip('/api/auth/links/github/start?return=/', OWNER_GITHUB, owner);
    assert.equal(res.status, 302);
    assert.equal(res.location, '/');
    assert.equal(res.cookies().cairn_session, undefined, '연결은 새 로그인을 만들지 않는다');
    const links = (await api.get('/api/auth/links', owner)).json().links as Record<
      string,
      unknown
    >[];
    assert.deepEqual(
      links.map((l) => [l.method, l.label]),
      [['github', 'user1001']],
    );
  });

  test('연결한 GitHub 계정으로 주인 로그인이 된다', async () => {
    const res = await roundTrip(
      '/api/auth/login/github/start?return=/',
      OWNER_GITHUB,
      TestUser.visitor,
    );
    assert.equal(res.status, 302);
    assert.equal(res.location, '/');
    const session = new TestUser({ cairn_session: res.cookies().cairn_session ?? '' });
    assert.deepEqual((await api.get('/api/auth/me', session)).json(), {
      login: ApiClient.OWNER_LOGIN,
    });
  });

  test('연결하지 않은 다른 GitHub 계정은 안 된다', async () => {
    const res = await roundTrip('/api/auth/login/github/start', 2002, TestUser.visitor);
    assert.match(errorOf(res) ?? '', /연결하지 않은 계정이에요/);
  });

  test('주인이 시작한 연결을 로그인하지 않은 브라우저가 끝낼 수 없다', async () => {
    const begin = await api.get('/api/auth/links/github/start', owner);
    const state = new URL(begin.location ?? '').searchParams.get('state') ?? '';
    const stolen = await api.get(
      `/api/auth/login/github/callback?code=ok-2002&state=${state}`,
      new TestUser(begin.cookies()),
    );
    assert.match(errorOf(stolen) ?? '', /계정을 연결하려면 로그인해 주세요/);
  });

  test('로그인을 시작한 브라우저가 아니면 400 (state)', async () => {
    const res = await api.get('/api/auth/login/github/callback?code=ok-1001&state=forged');
    assert.equal(res.status, 400);
  });

  test('연결을 끊으면 그 GitHub 계정으로는 더 로그인되지 않는다', async () => {
    assert.equal((await api.request('DELETE', '/api/auth/links/github', owner)).status, 200);
    assert.deepEqual((await api.get('/api/auth/links', owner)).json(), { links: [] });
    const res = await roundTrip('/api/auth/login/github/start', OWNER_GITHUB, TestUser.visitor);
    assert.match(errorOf(res) ?? '', /연결하지 않은 계정이에요/);
  });

  test('플러그인을 끄면 버튼이 사라지고 로그인 주소는 404', async () => {
    await api.request('POST', '/api/plugins/login-github/disable', owner);
    assert.deepEqual((await api.get('/api/auth/methods')).json(), { methods: [] });
    assert.equal((await api.get('/api/auth/login/github/start')).status, 404);
    await api.request('POST', '/api/plugins/login-github/enable', owner);
  });
});
