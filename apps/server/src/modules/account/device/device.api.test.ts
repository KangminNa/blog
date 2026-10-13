import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';

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
  });

  test('스스로 등록: https나 localhost가 아닌 돌려보낼 주소는 거절', async () => {
    const bad = await api.request('POST', '/oauth/register', TestUser.visitor, {
      client_name: 'evil',
      redirect_uris: ['http://evil.example/cb'],
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.json().error, 'invalid_redirect_uri');
    assert.match(await registerClient(), /^cairn_[0-9a-f]{32}$/);
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
    assert.deepEqual(names, ['save_session'], '기본 권한(올리기 + 공개 읽기)으로 보이는 도구');
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
