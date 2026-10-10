import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';
import { Database, SystemActor, Unauthenticated, VisitorActor } from '../../platform';
import { OwnerService } from '../owner/owner.service';

// 설치 마법사와 주인 로그인 (M1 A, 비밀번호). 빈 서버 → 설치 코드 → 주인 계정(바로 로그인) → 그 뒤로는 아이디·비밀번호.
// 이 파일은 계정 데이터를 비우고 처음 설치부터 시작한다.

const LOGIN = ApiClient.OWNER_LOGIN;
const PASSWORD = ApiClient.OWNER_PASSWORD;
let api: ApiClient;
let browser: TestUser;
let owner: TestUser;

before(async () => {
  api = await ApiClient.start();
  await api.service(Database).sql`
    TRUNCATE account.web_sessions, account.login_links, account.space_members, account.users,
             account.secrets, account.settings, account.spaces CASCADE`;
});
after(() => api.close());

describe('처음 설치', () => {
  test('빈 서버는 설치 전이고, 첫 단계는 설치 코드', async () => {
    assert.deepEqual((await api.get('/api/install')).json(), { installed: false, step: 'code' });
    assert.equal((await api.get('/api/space')).json().installed, false);
  });

  test('설치 코드가 틀리면 403, 통행증 없이 주인 계정을 만들면 401', async () => {
    const wrong = await api.request('POST', '/api/install/verify', TestUser.visitor, {
      code: 'AAAA-AAAA',
    });
    assert.equal(wrong.status, 403);
    assert.deepEqual(wrong.json(), {
      code: 'forbidden',
      message: '설치 코드가 맞지 않아요',
      scope: 'install',
    });
    const noPass = await api.request('POST', '/api/install/owner', TestUser.visitor, {
      login: LOGIN,
      password: PASSWORD,
    });
    assert.equal(noPass.status, 401);
  });

  test('설치 코드가 맞으면 통행증 쿠키, 다음 단계는 주인 계정', async () => {
    const res = await api.request('POST', '/api/install/verify', TestUser.visitor, {
      code: api.installCode().toLowerCase().replace('-', ' '),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { verified: true, expiresIn: 600 });
    browser = new TestUser(res.cookies());
    assert.ok(browser.cookies.cairn_install);
    assert.equal((await api.get('/api/install', browser)).json().step, 'owner');
  });

  test('아이디 모양이 틀리거나 비밀번호가 짧거나 아이디와 같으면 400 (어느 칸인지)', async () => {
    const cases: [object, string][] = [
      [{ login: 'A b', password: PASSWORD }, 'login'],
      [{ login: LOGIN, password: 'short' }, 'password'],
      [{ login: 'owner-name', password: 'OWNER-NAME' }, 'password'],
    ];
    for (const [body, field] of cases) {
      const res = await api.request('POST', '/api/install/owner', browser, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(Object.keys(res.json().fields as object), [field]);
    }
  });

  test('주인 계정을 만들면 바로 로그인되고 설치가 끝난다. 비밀번호 원문은 어디에도 없다', async () => {
    const res = await api.request('POST', '/api/install/owner', browser, {
      login: 'Owner',
      password: PASSWORD,
    });
    assert.equal(res.status, 200);
    const cookies = res.cookies();
    assert.ok(cookies.cairn_session);
    assert.equal(cookies.cairn_install, '', '통행증은 다 썼으니 지운다');
    owner = new TestUser({ cairn_session: cookies.cairn_session ?? '' });
    assert.deepEqual((await api.get('/api/auth/me', owner)).json(), { login: 'owner' });
    assert.deepEqual((await api.get('/api/install')).json(), { installed: true, step: 'done' });
    const [row] = await api.service(Database).sql`
      SELECT password_hash FROM account.users WHERE login = 'owner'`;
    assert.match(String(row?.password_hash), /^scrypt\$/);
    assert.equal(String(row?.password_hash).includes(PASSWORD), false);
  });
});

describe('설치가 끝난 뒤', () => {
  test('설치 코드를 다시 넣거나 주인 계정을 또 만들면 409', async () => {
    const code = await api.request('POST', '/api/install/verify', TestUser.visitor, {
      code: api.installCode(),
    });
    assert.equal(code.status, 409);
    const again = await api.request('POST', '/api/install/owner', browser, {
      login: 'second',
      password: 'another-password',
    });
    assert.equal(again.status, 409);
  });

  test('비밀번호가 틀려도, 없는 아이디여도 같은 401 문구', async () => {
    const wrong = await api.login(LOGIN, 'wrong-password');
    const nobody = await api.login('nobody', PASSWORD);
    assert.equal(wrong.status, 401);
    assert.equal(nobody.status, 401);
    assert.deepEqual(wrong.json(), nobody.json());
    assert.equal(wrong.json().message, '아이디나 비밀번호가 맞지 않아요');
  });

  test('주인은 아이디·비밀번호로 로그인한다 (아이디는 대문자로 넣어도 된다)', async () => {
    const res = await api.login('OWNER', PASSWORD);
    assert.equal(res.status, 200);
    assert.ok(res.cookies().cairn_session);
  });
});

describe('블로그 정보', () => {
  test('방문자는 바꿀 수 없고(403), 주인은 version을 맞춰 이름·소개·사이트 주소를 바꾼다', async () => {
    const { version } = (await api.get('/api/space')).json() as { version: number };
    const visitor = await api.request('PUT', '/api/space', TestUser.visitor, {
      name: '해킹',
      version,
    });
    assert.equal(visitor.status, 403);
    const res = await api.request('PUT', '/api/space', owner, {
      name: ' 돌무더기 ',
      description: '작업 기록',
      siteUrl: 'https://blog.example.com/',
      version,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), {
      name: '돌무더기',
      description: '작업 기록',
      siteUrl: 'https://blog.example.com',
      installed: true,
      version: version + 1,
    });
  });

  test('소개를 비우면 지워지고, 사이트 주소를 비우면 그대로 둔다', async () => {
    const { version } = (await api.get('/api/space')).json() as { version: number };
    const res = await api.request('PUT', '/api/space', owner, {
      name: '돌무더기',
      description: '',
      siteUrl: '',
      version,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json().description, '');
    assert.equal(res.json().siteUrl, 'https://blog.example.com');
  });

  test('주소 모양이 아니면 422, 그사이 바뀐 것을 모르고 저장하면 409', async () => {
    const { version } = (await api.get('/api/space')).json() as { version: number };
    const bad = await api.request('PUT', '/api/space', owner, {
      name: '돌무더기',
      siteUrl: 'ftp://x',
      version,
    });
    assert.equal(bad.status, 422);
    const stale = await api.request('PUT', '/api/space', owner, { name: '옛 화면', version: 1 });
    assert.equal(stale.status, 409);
  });
});

describe('비밀번호 바꾸기', () => {
  test('지금 비밀번호가 틀리면 401, 새 비밀번호가 짧으면 400 (next 칸)', async () => {
    const wrong = await api.request('PUT', '/api/auth/password', owner, {
      current: 'not-the-password',
      next: 'a-new-long-password',
    });
    assert.equal(wrong.status, 401);
    const short = await api.request('PUT', '/api/auth/password', owner, {
      current: PASSWORD,
      next: 'short',
    });
    assert.equal(short.status, 400);
    assert.deepEqual(Object.keys(short.json().fields as object), ['next']);
  });

  test('바꾸면 지금 로그인만 남고 다른 로그인은 끝난다. 새 비밀번호로만 로그인된다', async () => {
    const other = new TestUser({
      cairn_session: (await api.login(LOGIN, PASSWORD)).cookies().cairn_session ?? '',
    });
    assert.equal((await api.get('/api/auth/me', other)).status, 200);
    const res = await api.request('PUT', '/api/auth/password', owner, {
      current: PASSWORD,
      next: 'a-new-long-password',
    });
    assert.equal(res.status, 200);
    assert.equal((await api.get('/api/auth/me', owner)).status, 200, '바꾼 사람은 그대로');
    assert.equal((await api.get('/api/auth/me', other)).status, 401, '다른 로그인은 끝남');
    assert.equal((await api.login(LOGIN, PASSWORD)).status, 401);
    assert.equal((await api.login(LOGIN, 'a-new-long-password')).status, 200);
  });

  test('명령줄에서 다시 정하면 모든 로그인이 끝나고, 다른 곳에서는 부를 수 없다', async () => {
    const owners = api.service(OwnerService);
    await assert.rejects(owners.resetPassword(new VisitorActor(), PASSWORD), Unauthenticated);
    await owners.resetPassword(new SystemActor(), PASSWORD);
    assert.equal((await api.get('/api/auth/me', owner)).status, 401);
    const back = await api.login(LOGIN, PASSWORD);
    assert.equal(back.status, 200);
    owner = new TestUser({ cairn_session: back.cookies().cairn_session ?? '' });
  });
});

describe('로그아웃과 시도 제한', () => {
  test('로그아웃하면 그 쿠키로는 주인이 아니다', async () => {
    const extra = (await api.login(LOGIN, PASSWORD)).cookies().cairn_session;
    const session = new TestUser({ cairn_session: extra ?? '' });
    assert.equal((await api.request('POST', '/api/auth/logout', session)).status, 200);
    assert.equal((await api.get('/api/auth/me', session)).status, 401);
    assert.equal((await api.get('/api/auth/me', owner)).status, 200, '다른 로그인은 그대로');
  });

  test('틀린 비밀번호를 거듭 넣으면 429, 그동안 맞는 비밀번호도 막힌다', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await api.login(LOGIN, 'guess-guess-guess')).status);
    assert.equal(statuses.at(-1), 429);
    assert.equal((await api.login(LOGIN, PASSWORD)).status, 429);
  });

  test('설치 코드를 마구 넣으면 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await api.request('POST', '/api/install/verify', TestUser.visitor, {
        code: 'ZZZZ-ZZZZ',
      });
      statuses.push(res.status);
    }
    assert.equal(statuses.at(-1), 429);
  });
});
