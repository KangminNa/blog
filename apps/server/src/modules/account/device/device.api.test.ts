import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';
import { ServerRunnerPolicy } from './server-runner.policy';

// 기기 연결 (M1 B, MCP OAuth 2.1). AI 도구가 하는 순서 그대로 끝까지 돌린다:
//   /mcp 401 → 안내 문서 → 스스로 등록 → 승인 요청 → 주인이 승인 화면에서 연결 → 코드를 토큰으로(PKCE) → /mcp
// 그리고 갱신·재사용 감지·끊기·권한 바꾸기·예비 기기 토큰.

let api: ApiClient;
let owner: TestUser;
let site: string;
const REDIRECT = 'http://localhost:33418/callback';

/** PKCE 한 쌍 */
function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function registerClient(name = 'Claude Code'): Promise<string> {
  const res = await api.request('POST', '/oauth/register', TestUser.visitor, {
    client_name: name,
    redirect_uris: [REDIRECT],
  });
  assert.equal(res.status, 201, res.text);
  return String(res.json().client_id);
}

function authorizePath(clientId: string, challenge: string, state = 'st-1'): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `/oauth/authorize?${q}`;
}

/** 등록부터 토큰까지. 기기 이름을 정해 연결하고 토큰을 돌려준다 */
async function connect(name: string): Promise<{ access: string; refresh: string }> {
  const clientId = await registerClient();
  const { verifier, challenge } = pkce();
  const begin = await api.get(authorizePath(clientId, challenge));
  const request = new URL(begin.location ?? '').searchParams.get('request') ?? '';
  const approved = await api.request('POST', '/api/connect/approve', owner, { request, name });
  assert.equal(approved.status, 200, approved.text);
  const code = new URL(String(approved.json().redirect)).searchParams.get('code') ?? '';
  const token = await api.form('/oauth/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
  });
  assert.equal(token.status, 200, token.text);
  return { access: String(token.json().access_token), refresh: String(token.json().refresh_token) };
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  site = api.baseUrl;
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '돌무더기', siteUrl: site, version });
});
after(() => api.close());

describe('AI 도구가 찾아오기', () => {
  test('토큰 없이 /mcp를 부르면 401과 함께 안내 문서 주소를 알려준다', async () => {
    const res = await api.mcp(null, 'initialize');
    assert.equal(res.status, 401);
    assert.equal(
      res.header('www-authenticate'),
      `Bearer resource_metadata="${site}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  test('안내 문서: /mcp는 이 블로그가 인가 서버이고, 등록·승인·토큰 주소와 PKCE(S256)', async () => {
    assert.deepEqual((await api.get('/.well-known/oauth-protected-resource/mcp')).json(), {
      resource: `${site}/mcp`,
      authorization_servers: [site],
      bearer_methods_supported: ['header'],
      resource_name: 'Cairn',
    });
    const meta = (await api.get('/.well-known/oauth-authorization-server')).json();
    assert.equal(meta.issuer, site);
    assert.equal(meta.registration_endpoint, `${site}/oauth/register`);
    assert.equal(meta.authorization_endpoint, `${site}/oauth/authorize`);
    assert.equal(meta.token_endpoint, `${site}/oauth/token`);
    assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
    assert.ok(
      (meta.scopes_supported as string[]).includes('offline_access'),
      '갱신 토큰을 쓴다는 표시',
    );
  });

  test('스스로 등록: 돌려보낼 주소는 이 컴퓨터(localhost)와 ChatGPT·Claude 앱만. 다른 https는 거절', async () => {
    for (const uri of [
      'http://evil.example/cb',
      'https://evil.example/cb',
      'https://claude.ai/other',
    ]) {
      const bad = await api.request('POST', '/oauth/register', TestUser.visitor, {
        client_name: 'evil',
        redirect_uris: [uri],
      });
      assert.equal(bad.status, 400, uri);
      assert.equal(bad.json().error, 'invalid_redirect_uri');
      assert.match(
        String(bad.json().error_description),
        /이 컴퓨터\(http:\/\/localhost\) · 브라우저 확장 · ChatGPT·Claude 앱만/,
      );
    }
    for (const uri of ['http://127.0.0.1:5555/callback', 'http://[::1]:5555/callback'])
      assert.equal(
        (
          await api.request('POST', '/oauth/register', TestUser.visitor, {
            client_name: 'cli',
            redirect_uris: [uri],
          })
        ).status,
        201,
        uri,
      );
    assert.match(await registerClient(), /^cairn_[0-9a-f]{32}$/);
  });

  test('스스로 등록은 한 곳(IP)에서 1시간에 20번까지. 21번째는 429 (OAuth 오류 모양)', async () => {
    // 이 파일의 다른 등록과 세지 않게 새 서버(같은 DB)로 센다
    const fresh = await ApiClient.start();
    try {
      const body = { client_name: 'Claude Code', redirect_uris: [REDIRECT] };
      for (let i = 0; i < 20; i++)
        assert.equal(
          (await fresh.request('POST', '/oauth/register', TestUser.visitor, body)).status,
          201,
        );
      const over = await fresh.request('POST', '/oauth/register', TestUser.visitor, body);
      assert.equal(over.status, 429);
      assert.deepEqual(over.json(), {
        error: 'temporarily_unavailable',
        error_description: '잠시 뒤 다시 등록해 주세요',
      });
    } finally {
      await fresh.close();
    }
  });

  test('하루가 지나도록 토큰을 받지 않은 등록은 새 등록이 들어올 때 지운다. 토큰을 받은 등록은 남는다', async () => {
    const sql = api.service(Database).sql;
    const unused = await registerClient('unused');
    const used = await registerClient('used');
    const { verifier, challenge } = pkce();
    const begin = await api.get(authorizePath(used, challenge));
    const request = new URL(begin.location ?? '').searchParams.get('request') ?? '';
    const approved = await api.request('POST', '/api/connect/approve', owner, {
      request,
      name: 'old-pc',
    });
    const code = new URL(String(approved.json().redirect)).searchParams.get('code') ?? '';
    const token = await api.form('/oauth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: used,
      code_verifier: verifier,
    });
    assert.equal(token.status, 200, token.text);
    await sql`UPDATE account.oauth_clients SET created_at = now() - interval '2 days'
              WHERE client_id IN (${unused}, ${used})`;
    await registerClient('new');
    const left =
      await sql`SELECT client_id FROM account.oauth_clients WHERE client_id IN (${unused}, ${used})`;
    assert.deepEqual(
      left.map((r) => r.client_id),
      [used],
    );
  });
});

describe('승인 요청', () => {
  test('등록 안 된 클라이언트나 다른 돌려보낼 주소는 돌려보내지 않고 400', async () => {
    const { challenge } = pkce();
    assert.equal((await api.get(authorizePath('cairn_nobody', challenge))).status, 400);
    const clientId = await registerClient();
    const other = authorizePath(clientId, challenge).replace(
      encodeURIComponent(REDIRECT),
      encodeURIComponent('http://localhost:9/other'),
    );
    assert.equal((await api.get(other)).status, 400);
  });

  test('PKCE가 없으면 돌려보낼 주소에 error와 state를 붙여 돌려보낸다', async () => {
    const clientId = await registerClient();
    const res = await api.get(
      `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=xyz`,
    );
    assert.equal(res.status, 302);
    const back = new URL(res.location ?? '');
    assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
    assert.equal(back.searchParams.get('error'), 'invalid_request');
    assert.equal(back.searchParams.get('state'), 'xyz');
  });

  test('올바른 요청은 승인 화면으로. 승인 화면은 주인만 보고, 기본 권한은 올리기 + 공개 읽기', async () => {
    const clientId = await registerClient('Claude Code');
    const res = await api.get(authorizePath(clientId, pkce().challenge));
    const to = new URL(res.location ?? '');
    assert.equal(`${to.origin}${to.pathname}`, `${site}/connect`);
    const request = to.searchParams.get('request') ?? '';
    const path = `/api/connect?request=${encodeURIComponent(request)}`;
    assert.equal((await api.get(path)).status, 403, '방문자는 승인 화면을 볼 수 없다');
    assert.deepEqual((await api.get(path, owner)).json(), {
      clientName: 'Claude Code',
      redirectHost: 'localhost:33418',
      name: 'Claude Code',
      scopes: ['upload', 'read_public'],
      app: null,
    });
  });

  test('주인이 거절하면 access_denied를 붙여 돌려보낸다', async () => {
    const clientId = await registerClient();
    const res = await api.get(authorizePath(clientId, pkce().challenge, 'deny-state'));
    const request = new URL(res.location ?? '').searchParams.get('request') ?? '';
    const denied = await api.request('POST', '/api/connect/deny', owner, { request });
    const back = new URL(String(denied.json().redirect));
    assert.equal(back.searchParams.get('error'), 'access_denied');
    assert.equal(back.searchParams.get('state'), 'deny-state');
    assert.equal(
      back.searchParams.get('iss'),
      site,
      '돌려보낼 때 인가 서버 주소를 붙인다 (RFC 9207)',
    );
  });
});

describe('ChatGPT·Claude 앱 연결 (앱 연결 허용 스위치)', () => {
  const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
  const CHATGPT = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const CHATGPT_OLD = 'https://chatgpt.com/connector/oauth/abc123';
  const toggle = async (on: boolean) => {
    const { version } = (await api.get('/api/space')).json() as { version: number };
    const res = await api.request('PUT', '/api/space/hosted-apps', owner, { on, version });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json().hostedApps, on);
  };
  // 등록 횟수 제한(IP당 1시간 20번)을 이 파일의 다른 등록과 나눠 쓰지 않게, 등록은 새 서버(같은 DB)로 한다
  let apps: ApiClient;
  before(async () => {
    apps = await ApiClient.start();
  });
  after(() => apps.close());
  const register = (uri: string) =>
    apps.request('POST', '/oauth/register', TestUser.visitor, {
      client_name: 'App',
      redirect_uris: [uri],
    });

  test('꺼져 있으면(기본) 앱 주소로 등록할 수 없다. 켜면 정해 둔 앱 주소만 된다', async () => {
    assert.equal((await api.get('/api/space')).json().hostedApps, false, '기본은 꺼짐');
    const off = await register(CLAUDE);
    assert.equal(off.status, 400);
    assert.match(String(off.json().error_description), /ChatGPT·Claude 앱 연결이 꺼진 블로그예요/);
    await toggle(true);
    for (const uri of [CLAUDE, CHATGPT, CHATGPT_OLD])
      assert.equal((await register(uri)).status, 201, uri);
    assert.equal((await register('https://chatgpt.com/other')).status, 400);
    await toggle(false);
  });

  test('승인 화면은 앱 연결임을 알리고, 돌려보낼 때 iss를 붙인다. 등록 뒤에 끄면 승인 요청부터 막는다', async () => {
    await toggle(true);
    const clientId = String((await register(CLAUDE)).json().client_id);
    const q = (state: string) =>
      `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CLAUDE, code_challenge: pkce().challenge, code_challenge_method: 'S256', state })}`;
    const request =
      new URL((await api.get(q('app-1'))).location ?? '').searchParams.get('request') ?? '';
    const consent = (
      await api.get(`/api/connect?request=${encodeURIComponent(request)}`, owner)
    ).json();
    assert.equal(consent.app, 'Claude');
    assert.equal(consent.redirectHost, 'claude.ai');
    const approved = await api.request('POST', '/api/connect/approve', owner, {
      request,
      name: 'claude-web',
    });
    const back = new URL(String(approved.json().redirect));
    assert.equal(`${back.origin}${back.pathname}`, CLAUDE);
    assert.equal(back.searchParams.get('iss'), site);
    assert.ok(back.searchParams.get('code'));
    await toggle(false);
    const blocked = await api.get(q('app-2'));
    assert.equal(blocked.status, 400, '꺼진 뒤에는 앱 주소로 돌려보내지 않는다');
    assert.match(
      String(blocked.json().error_description),
      /ChatGPT·Claude 앱 연결이 꺼진 블로그예요/,
    );
  });

  test('스위치는 주인만, 맞는 version으로만 바꾼다', async () => {
    const { version } = (await api.get('/api/space')).json() as { version: number };
    assert.equal(
      (await api.request('PUT', '/api/space/hosted-apps', TestUser.visitor, { on: true, version }))
        .status,
      403,
    );
    assert.equal(
      (await api.request('PUT', '/api/space/hosted-apps', owner, { on: true, version: 1 })).status,
      409,
    );
    const bad = await api.request('PUT', '/api/space/hosted-apps', owner, { on: 'yes', version });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json().fields, { on: 'true나 false여야 해요' });
  });
});

describe('코드를 토큰으로', () => {
  test('PKCE 확인값이 틀리면 invalid_grant, 맞으면 토큰. 같은 코드는 두 번 쓸 수 없다', async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const begin = await api.get(authorizePath(clientId, challenge, 'st-2'));
    const request = new URL(begin.location ?? '').searchParams.get('request') ?? '';
    const approved = await api.request('POST', '/api/connect/approve', owner, {
      request,
      name: 'macbook-home',
    });
    const back = new URL(String(approved.json().redirect));
    assert.equal(back.searchParams.get('state'), 'st-2');
    const code = back.searchParams.get('code') ?? '';
    const body = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
    };
    const wrong = await api.form('/oauth/token', { ...body, code_verifier: pkce().verifier });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json().error, 'invalid_grant');
    const ok = await api.form('/oauth/token', { ...body, code_verifier: verifier });
    assert.equal(ok.status, 200);
    assert.equal(ok.header('cache-control'), 'no-store');
    assert.equal(ok.json().token_type, 'Bearer');
    assert.equal(ok.json().scope, 'upload read_public');
    assert.match(String(ok.json().access_token), /^cairn_at_/);
    const again = await api.form('/oauth/token', { ...body, code_verifier: verifier });
    assert.equal(again.json().error, 'invalid_grant');
  });

  test('연결된 기기 이름과 같은 이름으로 또 승인하면 422', async () => {
    const clientId = await registerClient();
    const begin = await api.get(authorizePath(clientId, pkce().challenge));
    const request = new URL(begin.location ?? '').searchParams.get('request') ?? '';
    const res = await api.request('POST', '/api/connect/approve', owner, {
      request,
      name: 'macbook-home',
    });
    assert.equal(res.status, 422);
  });
});

describe('MCP', () => {
  test('토큰으로 /mcp에 들어와 서버 정보와 도구 목록을 받는다', async () => {
    const { access } = await connect('work-pc');
    const init = await api.mcp(access, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    assert.equal(init.status, 200, init.text);
    const result = init.json().result as { serverInfo: { name: string } };
    assert.equal(result.serverInfo.name, 'cairn');
    const tools = await api.mcp(access, 'tools/list');
    assert.equal(tools.status, 200, tools.text);
    const names = (tools.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
    assert.deepEqual(
      names,
      [
        'check_session',
        'save_session',
        'search_sessions',
        'get_session',
        'search_wikis',
        'get_wiki',
        'neighbors',
        'save_transcript',
        'keep_page',
      ],
      '기본 권한(올리기 + 공개 읽기)으로 보이는 도구',
    );
    const annotated = (
      tools.json().result as { tools: { name: string; annotations: Record<string, boolean> }[] }
    ).tools.map((t) => [t.name, t.annotations.readOnlyHint, t.annotations.destructiveHint]);
    assert.deepEqual(annotated, [
      ['check_session', true, false],
      ['save_session', false, false],
      ['search_sessions', true, false],
      ['get_session', true, false],
      ['search_wikis', true, false],
      ['get_wiki', true, false],
      ['neighbors', true, false],
      ['save_transcript', false, false],
      ['keep_page', false, false],
    ]);
    const instructions = String(
      (init.json().result as { instructions?: string }).instructions ?? '',
    );
    assert.match(instructions, /check_session/);
    assert.ok(instructions.length > 0);
  });

  test('Bearer 토큰으로 오는 요청은 Origin을 보지 않는다 (AI 도구는 브라우저가 아니다)', async () => {
    const { access } = await connect('origin-pc');
    const res = await fetch(`${api.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${access}`,
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(res.status, 200, await res.text());
  });
});

// cairn connect가 만드는 소식 기기 (2차 1-3): 승인 요청에 scope=news를 실으면 소식만 읽는 기기가 따로 생긴다.
describe('소식 기기 (scope=news)', () => {
  /** 이 파일의 다른 등록과 세지 않게 등록만 새 서버(같은 DB)에서 한다 */
  let fresh: ApiClient;
  before(async () => {
    fresh = await ApiClient.start();
  });
  after(() => fresh.close());

  const register = async (redirect = REDIRECT): Promise<string> => {
    const res = await fresh.request('POST', '/oauth/register', TestUser.visitor, {
      client_name: 'macbook · 소식',
      redirect_uris: [redirect],
    });
    assert.equal(res.status, 201, res.text);
    return String(res.json().client_id);
  };
  const ask = (clientId: string, challenge: string, scope: string, redirect = REDIRECT) =>
    api.get(
      `${authorizePath(clientId, challenge, 'news-state').replace(encodeURIComponent(REDIRECT), encodeURIComponent(redirect))}&scope=${encodeURIComponent(scope)}`,
    );
  const requestOf = (res: { location: string | null }) =>
    new URL(res.location ?? '').searchParams.get('request') ?? '';

  test('승인 화면은 요청한 권한(news)만 보이고, 승인하면 news 하나만 가진 기기와 토큰이 생긴다', async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const request = requestOf(await ask(clientId, challenge, 'news'));
    const shown = await api.get(`/api/connect?request=${encodeURIComponent(request)}`, owner);
    assert.deepEqual(shown.json(), {
      clientName: 'macbook · 소식',
      redirectHost: 'localhost:33418',
      name: 'macbook · 소식',
      scopes: ['news'],
      app: null,
    });
    const approved = await api.request('POST', '/api/connect/approve', owner, {
      request,
      name: 'macbook · 소식',
    });
    assert.equal(approved.status, 200, approved.text);
    const code = new URL(String(approved.json().redirect)).searchParams.get('code') ?? '';
    const token = await api.form('/oauth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    });
    assert.equal(token.status, 200, token.text);
    assert.equal(token.json().scope, 'news');
    const access = String(token.json().access_token);
    assert.equal(
      (await api.mcp(access, 'tools/list')).status,
      200,
      '소식 기기의 토큰으로 들어온다',
    );
    const saved = await api.mcp(access, 'tools/call', { name: 'search_wikis', arguments: {} });
    assert.equal(
      (saved.json().result as { isError?: boolean }).isError,
      true,
      '소식 말고는 읽지 못한다',
    );

    const renewed = await api.form('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: String(token.json().refresh_token),
    });
    assert.equal(renewed.json().scope, 'news', '갱신해도 소식 권한만');
    const list = (await api.get('/api/devices', owner)).json().devices as Record<string, unknown>[];
    const device = list.find((d) => d.name === 'macbook · 소식') as Record<string, unknown>;
    assert.deepEqual(device.scopes, ['news']);

    // 관리자도 소식 기기의 권한은 바꾸지 못한다 (이름은 된다). news를 다른 기기에 줄 수도 없다
    const widened = await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: ['news', 'read_all'],
      version: device.version,
    });
    assert.equal(widened.status, 422, widened.text);
    const renamed = await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      name: 'macbook 소식',
      version: device.version,
    });
    assert.equal(renamed.status, 200, renamed.text);
    assert.deepEqual(renamed.json().scopes, ['news']);
    const other = (
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: 'laptop-news',
      })
    ).json() as Record<string, unknown>;
    const granted = await api.request('PATCH', `/api/devices/${other.id}`, owner, {
      scopes: ['run', 'news'],
      version: other.version,
    });
    assert.equal(granted.status, 400, granted.text);
  });

  test('news를 다른 권한과 함께 요청하거나 앱의 주소로 요청하면 invalid_scope로 돌려보낸다', async () => {
    const clientId = await register();
    for (const scope of ['news upload', 'read_all news']) {
      const res = await ask(clientId, pkce().challenge, scope);
      const back = new URL(res.location ?? '');
      assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
      assert.equal(back.searchParams.get('error'), 'invalid_scope');
      assert.equal(back.searchParams.get('state'), 'news-state');
    }
    const offline = requestOf(await ask(clientId, pkce().challenge, 'news offline_access'));
    const shown = await api.get(`/api/connect?request=${encodeURIComponent(offline)}`, owner);
    assert.deepEqual(shown.json().scopes, ['news'], 'offline_access는 권한이 아니다');

    const { version } = (await api.get('/api/space')).json() as { version: number };
    const on = await api.request('PUT', '/api/space/hosted-apps', owner, { on: true, version });
    assert.equal(on.status, 200, on.text);
    try {
      const app = 'https://claude.ai/api/mcp/auth_callback';
      const res = await ask(await register(app), pkce().challenge, 'news', app);
      assert.equal(new URL(res.location ?? '').searchParams.get('error'), 'invalid_scope');
    } finally {
      const now = (await api.get('/api/space')).json() as { version: number };
      await api.request('PUT', '/api/space/hosted-apps', owner, {
        on: false,
        version: now.version,
      });
    }
  });

  test('collect는 올리기만, extension은 확장의 주소로만 올리기 · 맡기기 · 결재 보기를 받는다 (2차 4단계)', async () => {
    const shownFor = async (clientId: string, scope: string, redirect = REDIRECT) => {
      const request = requestOf(await ask(clientId, pkce().challenge, scope, redirect));
      return (await api.get(`/api/connect?request=${encodeURIComponent(request)}`, owner)).json();
    };
    const local = await register();
    assert.deepEqual((await shownFor(local, 'collect')).scopes, ['upload']);

    const extension = `https://${'b'.repeat(32)}.chromiumapp.org/`;
    const ext = await register(extension);
    // 확장의 주소는 확장 id(a~p 32자)의 맨 위 경로만
    for (const uri of [
      'https://short.chromiumapp.org/',
      `https://${'q'.repeat(32)}.chromiumapp.org/`,
      `https://${'a'.repeat(32)}.chromiumapp.org/cb`,
    ]) {
      const bad = await fresh.request('POST', '/oauth/register', TestUser.visitor, {
        client_name: 'ext',
        redirect_uris: [uri],
      });
      assert.equal(bad.status, 400, uri);
    }
    const shown = await shownFor(ext, 'extension offline_access', extension);
    assert.deepEqual(shown.scopes, ['upload', 'delegate', 'inbox']);
    assert.equal(shown.redirectHost, `${'b'.repeat(32)}.chromiumapp.org`);
    assert.equal(shown.app, null);

    // 확장의 주소는 extension만, extension은 확장의 주소만, collect는 다른 권한과 섞지 않는다
    for (const [clientId, scope, redirect] of [
      [ext, '', extension],
      [ext, 'collect', extension],
      [local, 'extension', REDIRECT],
      [local, 'collect upload', REDIRECT],
    ] as const) {
      const back = new URL((await ask(clientId, pkce().challenge, scope, redirect)).location ?? '');
      assert.equal(back.searchParams.get('error'), 'invalid_scope', `${scope} → ${redirect}`);
    }
  });

  test('news가 없는 요청은 지금처럼: 다른 권한 이름은 보지 않고 기본 권한으로 승인 화면에 간다', async () => {
    const clientId = await register();
    const request = requestOf(
      await ask(clientId, pkce().challenge, 'upload read_public read_all delegate offline_access'),
    );
    const shown = await api.get(`/api/connect?request=${encodeURIComponent(request)}`, owner);
    assert.deepEqual(shown.json().scopes, ['upload', 'read_public']);
  });

  test('DB도 news를 다른 권한과 함께 두지 못하게 막는다', async () => {
    const db = api.service(Database);
    const [device] = await db.sql<{ id: string }[]>`
      SELECT id FROM account.devices WHERE scopes = ARRAY['news']::text[] LIMIT 1`;
    await assert.rejects(
      db.sql`UPDATE account.devices SET scopes = ARRAY['news', 'upload'] WHERE id = ${device?.id ?? ''}`,
      /devices_news_only/,
    );
  });
});

describe('러너 추가', () => {
  const add = (user: typeof owner, body: object) =>
    api.request('POST', '/api/devices/runner', user, body);

  test('주인이 만들면 run 권한만 가진 기기와 토큰을 한 번 준다', async () => {
    const requestId = randomUUID();
    const res = await add(owner, { requestId, name: '맥 러너' });
    assert.equal(res.status, 201, res.text);
    const runner = res.json() as { id: string; scopes: string[]; token: string };
    assert.deepEqual(runner.scopes, ['run']);
    assert.match(runner.token, /^cairn_dt_/);

    const tools = await api.mcp(runner.token, 'tools/list');
    const names = (tools.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
    assert.deepEqual(names, [
      'read_transcript',
      'save_note',
      'next_jobs',
      'report_progress',
      'submit_result',
      'release_job',
      'ai_login',
      'ai_login_refresh',
      'ai_signin',
      'begin_upload',
      'begin_download',
    ]);

    const again = await add(owner, { requestId, name: '맥 러너' });
    assert.equal(again.json().id, runner.id);
    assert.equal(again.json().token, undefined);
  });

  test('같은 이름은 409, 이름이 없으면 400, 주인이 아니면 403', async () => {
    const name = `러너-${randomUUID().slice(0, 8)}`;
    assert.equal((await add(owner, { requestId: randomUUID(), name })).status, 201);
    assert.equal((await add(owner, { requestId: randomUUID(), name })).status, 409);
    assert.equal((await add(owner, { requestId: randomUUID() })).status, 400);
    assert.equal((await add(TestUser.visitor, { requestId: randomUUID(), name })).status, 403);
  });

  test('끊으면 토큰도 바로 막힌다', async () => {
    const name = `러너-${randomUUID().slice(0, 8)}`;
    const runner = (await add(owner, { requestId: randomUUID(), name })).json() as {
      id: string;
      token: string;
    };
    await api.request('POST', `/api/devices/${runner.id}/revoke`, owner);
    assert.equal((await api.mcp(runner.token, 'tools/list')).status, 401);
  });
});

describe('서버 러너 (연결 값으로 스스로 연결)', () => {
  const pair = (secret: string, headers: Record<string, string> = {}) =>
    api.request('POST', '/api/devices/server-runner', TestUser.visitor, { secret }, headers);
  const secret = () => api.service(ServerRunnerPolicy).secret();

  test('맞는 연결 값이면 run 권한만 가진 "서버 러너"와 토큰을 준다. 다시 연결하면 같은 기기에 새 토큰, 앞 토큰은 무효', async () => {
    const first = await pair(secret());
    assert.equal(first.status, 200, first.text);
    const runner = first.json() as { id: string; name: string; scopes: string[]; token: string };
    assert.equal(runner.name, '서버 러너');
    assert.deepEqual(runner.scopes, ['run']);
    assert.match(runner.token, /^cairn_dt_/);
    assert.equal((await api.mcp(runner.token, 'tools/list')).status, 200);

    const again = (await pair(secret())).json() as { id: string; token: string };
    assert.equal(again.id, runner.id, '서버 러너는 하나');
    assert.notEqual(again.token, runner.token);
    assert.equal((await api.mcp(runner.token, 'tools/list')).status, 401, '앞 토큰은 바로 무효');
    assert.equal((await api.mcp(again.token, 'tools/list')).status, 200);

    const { devices } = (await api.get('/api/devices', owner)).json() as {
      devices: { id: string; name: string }[];
    };
    assert.equal(devices.filter((d) => d.name === '서버 러너').length, 1);
  });

  test('주인이 끊으면 토큰은 바로 막히고, 러너가 다시 연결하면 새 서버 러너가 생긴다', async () => {
    const before = (await pair(secret())).json() as { id: string; token: string };
    await api.request('POST', `/api/devices/${before.id}/revoke`, owner);
    assert.equal((await api.mcp(before.token, 'tools/list')).status, 401);
    const after = (await pair(secret())).json() as { id: string; token: string };
    assert.notEqual(after.id, before.id);
    assert.equal((await api.mcp(after.token, 'tools/list')).status, 200);
  });

  test('연결 값이 틀리면 403, 모양이 틀리면 400. 토큰을 주지 않는다', async () => {
    const wrong = await pair('wrong-secret');
    assert.equal(wrong.status, 403, wrong.text);
    assert.equal(wrong.json().token, undefined);
    const empty = await api.request('POST', '/api/devices/server-runner', TestUser.visitor, {});
    assert.equal(empty.status, 400);
  });

  test('다른 기기가 "서버 러너" 이름을 쓰고 있으면 409로 알린다', async () => {
    const current = (await pair(secret())).json() as { id: string };
    await api.request('POST', `/api/devices/${current.id}/revoke`, owner);
    const imposter = await api.request('POST', '/api/devices/runner', owner, {
      requestId: randomUUID(),
      name: '서버 러너',
    });
    assert.equal(imposter.status, 201, imposter.text);
    const blocked = await pair(secret());
    assert.equal(blocked.status, 409, blocked.text);
    await api.request('POST', `/api/devices/${imposter.json().id}/revoke`, owner);
    assert.equal((await pair(secret())).status, 200);
  });

  test('한 곳(IP)에서 1시간에 30번까지. 넘으면 429', async () => {
    const fresh = await ApiClient.start();
    try {
      await fresh.signIn();
      const box = fresh.service(ServerRunnerPolicy).secret();
      const call = () =>
        fresh.request('POST', '/api/devices/server-runner', TestUser.visitor, { secret: box });
      for (let i = 0; i < 30; i++) assert.equal((await call()).status, 200);
      assert.equal((await call()).status, 429);
    } finally {
      await fresh.close();
    }
  });
});

describe('코드 러너 칸 (칸마다 기기 하나, 서버 러너와 다른 연결 값)', () => {
  const pair = (secret: string, slot: unknown = '1') =>
    api.request('POST', '/api/devices/code-runner', TestUser.visitor, { secret, slot });
  const secret = () => api.service(ServerRunnerPolicy).codeSecret();
  type Paired = { id: string; name: string; scopes: string[]; token: string; version: number };

  test('칸마다 "코드 러너 <칸>" 기기 하나. 권한은 run · sandbox, 다시 연결하면 같은 기기에 새 토큰', async () => {
    const one = await pair(secret(), '1');
    assert.equal(one.status, 200, one.text);
    const first = one.json() as Paired;
    assert.equal(first.name, '코드 러너 1');
    assert.deepEqual(first.scopes, ['run', 'sandbox']);
    assert.equal((await api.mcp(first.token, 'tools/list')).status, 200);

    const two = (await pair(secret(), '2')).json() as Paired;
    assert.equal(two.name, '코드 러너 2');
    assert.notEqual(two.id, first.id, '칸이 다르면 기기도 다르다');

    const again = (await pair(secret(), '1')).json() as Paired;
    assert.equal(again.id, first.id);
    assert.equal((await api.mcp(first.token, 'tools/list')).status, 401, '앞 토큰은 바로 무효');
    assert.equal((await api.mcp(two.token, 'tools/list')).status, 200, '다른 칸은 그대로');
  });

  test('서버 러너와 연결 값이 다르다: 서로의 값으로는 붙지 못한다 (403)', async () => {
    const policy = api.service(ServerRunnerPolicy);
    assert.notEqual(policy.codeSecret(), policy.secret());
    const swapped = await pair(policy.secret());
    assert.equal(swapped.status, 403, swapped.text);
    assert.equal(swapped.json().token, undefined);
    const reverse = await api.request('POST', '/api/devices/server-runner', TestUser.visitor, {
      secret: policy.codeSecret(),
    });
    assert.equal(reverse.status, 403, reverse.text);
  });

  test('칸 번호는 1~99, 모양이 틀리면 400', async () => {
    for (const slot of ['0', '100', 'a', '1 ', '', '01', 1, null])
      assert.equal((await pair(secret(), slot)).status, 400, String(slot));
  });

  test('주인은 칸 기기의 이름 · 권한을 바꾸지 못하고, sandbox는 다른 기기에 줄 수 없다', async () => {
    const slot = (await pair(secret(), '3')).json() as Paired;
    for (const changes of [
      { scopes: ['run'] },
      { scopes: ['run', 'read_all'] },
      { name: '딴 이름' },
    ]) {
      const tried = await api.request('PATCH', `/api/devices/${slot.id}`, owner, {
        ...changes,
        version: slot.version,
      });
      assert.equal(tried.status, 422, tried.text);
    }
    // 콘솔에서 만든 러너 (OAuth 등록 없이: 등록 횟수 한도를 쓰지 않게)
    const laptop = (
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: 'laptop-sandbox',
      })
    ).json() as Paired;
    const granted = await api.request('PATCH', `/api/devices/${laptop.id}`, owner, {
      scopes: ['run', 'sandbox'],
      version: laptop.version,
    });
    assert.equal(granted.status, 400, granted.text);
  });

  test('다른 기기가 칸의 이름을 쓰고 있으면 409', async () => {
    const imposter = await api.request('POST', '/api/devices/runner', owner, {
      requestId: randomUUID(),
      name: '코드 러너 9',
    });
    assert.equal(imposter.status, 201, imposter.text);
    const blocked = await pair(secret(), '9');
    assert.equal(blocked.status, 409, blocked.text);
    await api.request('POST', `/api/devices/${imposter.json().id}/revoke`, owner);
    assert.equal((await pair(secret(), '9')).status, 200);
  });
});

describe('갱신과 끊기', () => {
  test('갱신하면 새 토큰 한 쌍. 이미 쓴 갱신 토큰이 다시 오면 기기를 끊는다 (도난 감지)', async () => {
    const first = await connect('laptop-a');
    const renewed = await api.form('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: first.refresh,
    });
    assert.equal(renewed.status, 200, renewed.text);
    const next = String(renewed.json().access_token);
    assert.notEqual(next, first.access);
    assert.equal((await api.mcp(next, 'tools/list')).status, 200);
    const replay = await api.form('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: first.refresh,
    });
    assert.equal(replay.status, 400);
    assert.match(String(replay.json().error_description), /연결을 끊었어요/);
    assert.equal((await api.mcp(next, 'tools/list')).status, 401, '끊긴 기기의 토큰은 바로 무효');
  });

  test('주인은 기기 목록을 보고, 이름·권한을 바꾸고, 예비 토큰을 만들고, 끊는다', async () => {
    const { access } = await connect('desktop');
    const list = (await api.get('/api/devices', owner)).json().devices as Record<string, unknown>[];
    const device = list.find((d) => d.name === 'desktop') as Record<string, unknown>;
    assert.deepEqual(device.scopes, ['upload', 'read_public']);
    assert.equal(device.client, 'Claude Code');
    assert.equal((await api.get('/api/devices')).status, 403, '방문자는 볼 수 없다');

    const changed = await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      name: 'desktop-home',
      scopes: ['read_all', 'upload'],
      version: device.version,
    });
    assert.equal(changed.status, 200, changed.text);
    assert.deepEqual(changed.json().scopes, ['upload', 'read_all'], '권한 순서는 정해진 순서로');
    const stale = await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      name: 'old',
      version: device.version,
    });
    assert.equal(stale.status, 409);

    const issued = await api.request('POST', `/api/devices/${device.id}/token`, owner);
    const spare = String(issued.json().token);
    assert.match(spare, /^cairn_dt_/);
    assert.equal((await api.mcp(spare, 'tools/list')).status, 200, '예비 토큰으로도 들어온다');

    assert.equal(
      (await api.request('POST', `/api/devices/${device.id}/revoke`, owner)).status,
      200,
    );
    assert.equal((await api.mcp(access, 'tools/list')).status, 401);
    assert.equal((await api.mcp(spare, 'tools/list')).status, 401);
  });

  test('AI 도구가 토큰을 버리면(RFC 7009) 그 토큰만 무효', async () => {
    const { access, refresh } = await connect('tablet');
    assert.equal((await api.form('/oauth/revoke', { token: access })).status, 200);
    assert.equal((await api.mcp(access, 'tools/list')).status, 401);
    const renewed = await api.form('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: refresh,
    });
    assert.equal(renewed.status, 200, '갱신 토큰은 그대로 쓸 수 있다');
    assert.equal(
      (await api.form('/oauth/revoke', { token: 'nothing' })).status,
      200,
      '없는 토큰도 성공',
    );
  });
});

describe('write 기기와 관리 일', () => {
  test('write 권한 기기도 관리 일은 못 한다: 자기 권한 올리기, 토큰 만들기, 사이트·플러그인·연결된 로그인', async () => {
    // 이 파일의 다른 등록과 세지 않게 새 서버(같은 DB)로 연결한다 (스스로 등록은 IP당 1시간 20번)
    const fresh = await ApiClient.start();
    try {
      const access = await fresh.connectDevice(owner, 'writer');
      const list = (await api.get('/api/devices', owner)).json().devices as Record<
        string,
        unknown
      >[];
      const device = list.find((d) => d.name === 'writer') as Record<string, unknown>;
      const granted = await api.request('PATCH', `/api/devices/${device.id}`, owner, {
        scopes: ['upload', 'read_public', 'write'],
        version: device.version,
      });
      assert.equal(granted.status, 200, granted.text);

      const writer = { authorization: `Bearer ${access}` };
      const as = (method: string, path: string, body?: object) =>
        api.request(method, path, TestUser.visitor, body, writer);
      const { version: siteVersion } = (await api.get('/api/space')).json() as { version: number };
      const tries: [string, string, object?][] = [
        ['GET', '/api/devices'],
        [
          'PATCH',
          `/api/devices/${device.id}`,
          { scopes: ['upload', 'read_all', 'write', 'run'], version: granted.json().version },
        ],
        ['POST', `/api/devices/${device.id}/token`],
        ['POST', `/api/devices/${device.id}/revoke`],
        ['POST', '/api/devices/runner', { requestId: randomUUID(), name: 'stolen-runner' }],
        [
          'PUT',
          '/api/space',
          { name: '가로챔', siteUrl: 'https://evil.example', version: siteVersion },
        ],
        ['PUT', '/api/space/hosted-apps', { on: true, version: siteVersion }],
        ['POST', '/api/plugins/sync-github/enable'],
        [
          'PUT',
          '/api/plugins/sync-github/settings',
          { values: { apiUrl: 'https://evil.example' } },
        ],
        ['POST', '/api/plugins/sync-github/actions/check'],
        ['GET', '/api/auth/links'],
        ['DELETE', '/api/auth/links/github'],
      ];
      for (const [method, path, body] of tries) {
        const res = await as(method, path, body);
        assert.equal(res.status, 403, `${method} ${path}: ${res.text}`);
      }

      const latest = (await api.get('/api/devices', owner)).json().devices as Record<
        string,
        unknown
      >[];
      const same = latest.find((d) => d.id === device.id) as Record<string, unknown>;
      assert.deepEqual(same.scopes, ['upload', 'read_public', 'write'], '권한은 그대로');
      assert.equal(same.revokedAt ?? null, null, '스스로 끊지도 못한다');
      assert.equal((await api.get('/api/space')).json().siteUrl, site, '사이트 주소도 그대로');
      assert.equal((await api.mcp(access, 'tools/list')).status, 200, '자기 일(MCP)은 그대로 한다');
    } finally {
      await fresh.close();
    }
  });
});
