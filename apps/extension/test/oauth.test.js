import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { authorizeUrl, codeFrom, grantsAll, pkcePair, siteOrigin } from '../src/oauth.js';
import { Problem } from '../src/problem.js';

describe('블로그 주소', () => {
  it('https를 붙이고 origin만 남긴다', () => {
    assert.equal(siteOrigin('blog.example.com'), 'https://blog.example.com');
    assert.equal(siteOrigin(' https://blog.example.com/admin?x=1 '), 'https://blog.example.com');
  });

  it('이 컴퓨터 안의 주소만 http를 받는다', () => {
    assert.equal(siteOrigin('http://localhost:3000'), 'http://localhost:3000');
    assert.equal(siteOrigin('http://127.0.0.1:4000/'), 'http://127.0.0.1:4000');
    assert.throws(() => siteOrigin('http://blog.example.com'), /https 주소만/);
  });

  it('비었거나 웹 주소가 아니면 Problem', () => {
    assert.throws(() => siteOrigin(''), Problem);
    assert.throws(() => siteOrigin('ftp://blog.example.com'), /https:\/\/로 시작/);
    assert.throws(() => siteOrigin('http://[bad'), /주소 모양이 아니에요/);
  });
});

describe('PKCE', () => {
  it('challenge는 verifier의 SHA-256 (base64url, 채움 없음)', async () => {
    const { verifier, challenge } = await pkcePair();
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  });

  it('매번 다른 verifier', async () => {
    const [a, b] = await Promise.all([pkcePair(), pkcePair()]);
    assert.notEqual(a.verifier, b.verifier);
  });
});

describe('승인 주소와 돌아온 주소', () => {
  const meta = {
    issuer: 'https://blog.example.com',
    authorization_endpoint: 'https://blog.example.com/oauth/authorize',
  };
  const redirectUri = 'https://abc.chromiumapp.org/';

  it('승인 주소에 PKCE · state · scope=extension', () => {
    const url = new URL(
      authorizeUrl(meta, { clientId: 'c1', redirectUri, challenge: 'ch', state: 's1' }),
    );
    assert.equal(url.origin + url.pathname, 'https://blog.example.com/oauth/authorize');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      response_type: 'code',
      client_id: 'c1',
      redirect_uri: redirectUri,
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      state: 's1',
      scope: 'extension',
    });
  });

  it('안내 문서에 승인 주소가 없으면 Problem', () => {
    assert.throws(
      () => authorizeUrl({}, { clientId: 'c', redirectUri, challenge: 'x', state: 'y' }),
      /authorization_endpoint가 없어요/,
    );
  });

  it('돌아온 주소의 code', () => {
    const back = `${redirectUri}?code=abc&state=s1&iss=${encodeURIComponent(meta.issuer)}`;
    assert.equal(codeFrom(back, { state: 's1', issuer: meta.issuer }), 'abc');
  });

  it('다른 요청 · 다른 블로그 · 거절 · code 없음은 Problem', () => {
    const at = { state: 's1', issuer: meta.issuer };
    assert.throws(() => codeFrom(`${redirectUri}?code=a&state=s2`, at), /이 요청의 것이 아니에요/);
    assert.throws(
      () => codeFrom(`${redirectUri}?code=a&state=s1&iss=https://evil.example`, at),
      /다른 블로그/,
    );
    assert.throws(
      () =>
        codeFrom(`${redirectUri}?state=s1&error=access_denied&error_description=거절했어요`, at),
      (error) => error.code === 'access_denied' && /거절했어요/.test(error.message),
    );
    assert.throws(() => codeFrom(`${redirectUri}?state=s1`, at), /code가 없어요/);
    assert.throws(() => codeFrom('not a url', at), /읽지 못했어요/);
  });
});

describe('받은 권한', () => {
  it('upload · delegate · inbox가 다 있어야 한다', () => {
    assert.equal(grantsAll('upload delegate inbox'), true);
    assert.equal(grantsAll('inbox  delegate upload offline_access'), true);
    assert.equal(grantsAll('upload inbox'), false);
    assert.equal(grantsAll('upload read_all write'), false);
    assert.equal(grantsAll(undefined), false);
  });
});
