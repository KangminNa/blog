import assert from 'node:assert/strict';
import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
} from 'node:crypto';
import { describe, test } from 'node:test';
import { WebPush } from './web-push';

// 웹 푸시의 암호화(RFC 8291)와 VAPID 서명(RFC 8292). 라이브러리 없이 만들었으니 표준의 예로 맞춰 본다.

const b = (s: string) => Buffer.from(s, 'base64url');

/** 받는 쪽(브라우저)처럼 푼다: 시험에서 우리 본문이 풀리는지 본다 */
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(uaPrivate);
  const shared = ua.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const data = body.subarray(21 + idlen);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, '마지막 레코드 표시');
  return plain.subarray(0, -1);
}

describe('WebPush', () => {
  test('RFC 8291 5장의 예와 같은 본문을 만든다', () => {
    const body = WebPush.encrypt(
      Buffer.from('When I grow up, I want to be a watermelon'),
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'BTBZMqHH6r4Tts7J_aSIgg',
      b('DGv6ra1nlYgDCS1FRnbzlw'),
      b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
    );
    assert.equal(
      body.toString('base64url'),
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  test('보낼 때마다 새 키 · salt로 감싸고, 받는 쪽이 풀 수 있다. 틀린 키 · 큰 내용은 거절', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = randomBytes(16);
    const message = Buffer.from(
      JSON.stringify({ title: '결재를 기다려요', link: '/admin/approvals' }),
    );
    const one = WebPush.encrypt(
      message,
      ua.getPublicKey().toString('base64url'),
      auth.toString('base64url'),
    );
    const two = WebPush.encrypt(
      message,
      ua.getPublicKey().toString('base64url'),
      auth.toString('base64url'),
    );
    assert.notDeepEqual(one, two);
    assert.deepEqual(decrypt(one, ua.getPrivateKey(), auth), message);
    assert.throws(() => WebPush.encrypt(message, 'AAAA', auth.toString('base64url')), /공개 키/);
    assert.throws(
      () => WebPush.encrypt(message, ua.getPublicKey().toString('base64url'), 'AAAA'),
      /auth/,
    );
    assert.throws(
      () =>
        WebPush.encrypt(
          Buffer.alloc(5000),
          ua.getPublicKey().toString('base64url'),
          auth.toString('base64url'),
        ),
      /너무 커요/,
    );
  });

  test('VAPID: 같은 씨앗이면 같은 공개 키, JWT는 그 키로 검증되고 aud는 푸시 서비스의 출처', () => {
    const seed = randomBytes(32);
    const push = WebPush.fromSeed(seed);
    assert.equal(WebPush.fromSeed(seed).publicKeyText, push.publicKeyText);
    assert.equal(push.publicKey.length, 65);
    const now = new Date('2026-11-11T00:00:00Z');
    const header = push.authorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      'mailto:me@example.com',
      now,
    );
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    assert.ok(match);
    const [jwt = '', k] = [match[1], match[2]];
    assert.equal(k, push.publicKeyText);
    const [h, c, s] = jwt.split('.');
    assert.deepEqual(JSON.parse(b(String(h)).toString()), { typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(b(String(c)).toString());
    assert.equal(claims.aud, 'https://fcm.googleapis.com');
    assert.equal(claims.sub, 'mailto:me@example.com');
    assert.equal(claims.exp, Math.floor(now.getTime() / 1000) + 12 * 3600);
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: push.publicKey.subarray(1, 33).toString('base64url'),
        y: push.publicKey.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    assert.ok(
      verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, b(String(s))),
    );
  });
});
