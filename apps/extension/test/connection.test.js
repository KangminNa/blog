import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { Connection } from '../src/connection.js';
import { FakeFetch, MemoryStore } from './fakes.js';

const SITE = 'https://blog.example.com';
const REDIRECT = 'https://extension-id.chromiumapp.org/';
const NOW = Date.parse('2026-11-14T00:00:00Z');
const MINUTE = 60_000;

/** 연결 명령이 쓰는 것과 같은 서버 주소들. 토큰은 부를 때마다 access-<n> · refresh-<n> */
function fakeBlog({ scope = 'upload delegate inbox', resource = `${SITE}/mcp` } = {}) {
  let issued = 0;
  return new FakeFetch({
    [`GET ${SITE}/.well-known/oauth-protected-resource/mcp`]: () => ({
      body: { resource, resource_name: 'Cairn' },
    }),
    [`GET ${SITE}/.well-known/oauth-authorization-server`]: () => ({
      body: {
        issuer: SITE,
        authorization_endpoint: `${SITE}/oauth/authorize`,
        token_endpoint: `${SITE}/oauth/token`,
        registration_endpoint: `${SITE}/oauth/register`,
        revocation_endpoint: `${SITE}/oauth/revoke`,
      },
    }),
    [`POST ${SITE}/oauth/register`]: () => ({ status: 201, body: { client_id: 'client-1' } }),
    [`POST ${SITE}/oauth/token`]: () => {
      issued += 1;
      return {
        body: {
          access_token: `access-${issued}`,
          refresh_token: `refresh-${issued}`,
          expires_in: 3600,
          scope,
        },
      };
    },
    [`POST ${SITE}/oauth/revoke`]: () => ({ body: {} }),
  });
}

/** 승인 창: 주소를 적어 두고, 승인한 것처럼 돌아온 주소를 준다 */
function approver() {
  const opened = [];
  const launch = async (url) => {
    opened.push(new URL(url));
    const state = new URL(url).searchParams.get('state');
    return `${REDIRECT}?code=code-1&state=${state}&iss=${encodeURIComponent(SITE)}`;
  };
  return { opened, launch };
}

function connectedStore(leftMs) {
  return new MemoryStore({
    connection: {
      site: SITE,
      mcp: `${SITE}/mcp`,
      tokenEndpoint: `${SITE}/oauth/token`,
      revokeEndpoint: `${SITE}/oauth/revoke`,
      clientId: 'client-1',
      accessToken: 'access-0',
      refreshToken: 'refresh-0',
      expiresAt: new Date(NOW + leftMs).toISOString(),
      scope: 'upload delegate inbox',
    },
  });
}

function connection(store, blog, launch = approver().launch) {
  return new Connection({
    store,
    fetch: blog.fetch,
    launch,
    redirectUri: REDIRECT,
    now: () => NOW,
  });
}

describe('연결하기', () => {
  it('등록 → 승인 창(PKCE, scope=extension) → 토큰 → 저장', async () => {
    const store = new MemoryStore();
    const blog = fakeBlog();
    const { opened, launch } = approver();
    assert.equal(await connection(store, blog, launch).connect(SITE), SITE);

    const [register] = blog.to(`${SITE}/oauth/register`);
    assert.deepEqual(register.json, { client_name: 'Chrome 확장', redirect_uris: [REDIRECT] });
    const asked = opened[0].searchParams;
    assert.equal(asked.get('scope'), 'extension');
    assert.equal(asked.get('client_id'), 'client-1');
    assert.equal(asked.get('redirect_uri'), REDIRECT);
    const [token] = blog.to(`${SITE}/oauth/token`);
    assert.equal(token.form.grant_type, 'authorization_code');
    assert.equal(token.form.code, 'code-1');
    assert.equal(token.form.redirect_uri, REDIRECT);
    assert.equal(
      createHash('sha256').update(token.form.code_verifier).digest('base64url'),
      asked.get('code_challenge'),
    );
    assert.deepEqual(store.items.connection, {
      site: SITE,
      mcp: `${SITE}/mcp`,
      tokenEndpoint: `${SITE}/oauth/token`,
      revokeEndpoint: `${SITE}/oauth/revoke`,
      clientId: 'client-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date(NOW + 3600_000).toISOString(),
      scope: 'upload delegate inbox',
    });
    assert.deepEqual(await connection(store, blog).status(), { state: 'connected', site: SITE });
  });

  it('확장 권한이 없는 토큰이면 버리고(revoke) 저장하지 않는다', async () => {
    const store = new MemoryStore();
    const blog = fakeBlog({ scope: 'upload read_all write' });
    await assert.rejects(connection(store, blog).connect(SITE), /모르는 버전이에요/);
    const revoked = blog.to(`${SITE}/oauth/revoke`).map((call) => call.form.token);
    assert.deepEqual(revoked, ['refresh-1', 'access-1']);
    assert.equal(store.items.connection, undefined);
  });

  it('Cairn이 아니거나 사이트 주소가 다르면 멈춘다', async () => {
    await assert.rejects(
      connection(
        new MemoryStore(),
        fakeBlog({ resource: 'https://www.blog.example.com/mcp' }),
      ).connect(SITE),
      /사이트 주소로 연결해 주세요: https:\/\/www\.blog\.example\.com/,
    );
    await assert.rejects(
      connection(new MemoryStore(), fakeBlog({ resource: `${SITE}/other` })).connect(SITE),
      /Cairn 블로그가 아니에요/,
    );
  });

  it('승인 창을 닫으면 · 블로그에 닿지 않으면 Problem', async () => {
    const closed = async () => {
      throw new Error('The user did not approve access.');
    };
    await assert.rejects(connection(new MemoryStore(), fakeBlog(), closed).connect(SITE), {
      message: '승인 창이 닫혀 연결하지 못했어요',
    });
    await assert.rejects(
      connection(new MemoryStore(), new FakeFetch()).connect(SITE),
      /블로그에 닿지 않아요: https:\/\/blog\.example\.com/,
    );
  });
});

describe('토큰 쓰기 · 갱신', () => {
  it('넉넉하면 그대로', async () => {
    const blog = fakeBlog();
    const key = await connection(connectedStore(30 * MINUTE), blog).key();
    assert.equal(key.accessToken, 'access-0');
    assert.equal(blog.calls.length, 0);
  });

  it('10분 안에 끝나면 갱신한다. 같은 때 여러 번 불려도 갱신 토큰은 한 번만', async () => {
    const store = connectedStore(5 * MINUTE);
    const blog = fakeBlog();
    const c = connection(store, blog);
    const keys = await Promise.all([c.key(), c.key(), c.key()]);
    assert.deepEqual(
      keys.map((k) => k.accessToken),
      ['access-1', 'access-1', 'access-1'],
    );
    const refreshes = blog.to(`${SITE}/oauth/token`);
    assert.equal(refreshes.length, 1);
    assert.deepEqual(refreshes[0].form, {
      grant_type: 'refresh_token',
      refresh_token: 'refresh-0',
      client_id: 'client-1',
    });
    assert.equal(store.items.connection.refreshToken, 'refresh-1');
  });

  it('서버가 받지 않은 토큰이면(401) 갱신. 이미 바뀌었으면 다시 갱신하지 않는다', async () => {
    const blog = fakeBlog();
    const c = connection(connectedStore(30 * MINUTE), blog);
    assert.equal((await c.key('access-0')).accessToken, 'access-1');
    assert.equal((await c.key('access-0')).accessToken, 'access-1');
    assert.equal(blog.to(`${SITE}/oauth/token`).length, 1);
  });

  it('갱신 토큰이 죽으면(invalid_grant) 토큰을 지우고 "다시 연결"', async () => {
    const store = connectedStore(5 * MINUTE);
    const blog = new FakeFetch({
      [`POST ${SITE}/oauth/token`]: () => ({ status: 400, body: { error: 'invalid_grant' } }),
    });
    const c = connection(store, blog);
    await assert.rejects(c.key(), { code: 'lost', message: '연결이 끊겼어요. 다시 연결해 주세요' });
    assert.deepEqual(store.items.connection, { site: SITE, mcp: `${SITE}/mcp`, lost: true });
    assert.deepEqual(await c.status(), { state: 'lost', site: SITE });
    await assert.rejects(c.key(), { code: 'lost' });
    assert.equal(blog.calls.length, 1);
  });

  it('갱신이 잠깐 안 되면 아직 살아 있는 토큰을 쓰고, 끝난 토큰이면 실패', async () => {
    assert.equal(
      (await connection(connectedStore(5 * MINUTE), new FakeFetch()).key()).accessToken,
      'access-0',
    );
    await assert.rejects(
      connection(connectedStore(-MINUTE), new FakeFetch()).key(),
      /블로그에 닿지 않아요/,
    );
  });

  it('연결이 없으면 Problem', async () => {
    await assert.rejects(connection(new MemoryStore(), fakeBlog()).key(), { code: 'none' });
  });
});

describe('연결 해제', () => {
  it('저장한 열쇠를 지우고 서버에서도 두 토큰을 버린다', async () => {
    const store = connectedStore(30 * MINUTE);
    const blog = fakeBlog();
    assert.equal(await connection(store, blog).disconnect(), SITE);
    assert.equal(store.items.connection, undefined);
    assert.deepEqual(
      blog.to(`${SITE}/oauth/revoke`).map((call) => call.form),
      [
        { token: 'refresh-0', client_id: 'client-1' },
        { token: 'access-0', client_id: 'client-1' },
      ],
    );
  });

  it('서버에 닿지 않아도 이 브라우저에서는 지운다', async () => {
    const store = connectedStore(30 * MINUTE);
    await connection(store, new FakeFetch()).disconnect();
    assert.equal(store.items.connection, undefined);
  });
});
