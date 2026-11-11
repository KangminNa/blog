import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../base/database';
import { NoticePushJob } from './notice-push.job';

// 브라우저 푸시 (/api/push, 7단계)와 알림을 푸시로 보내는 일꾼. 푸시 서비스 대신 이 시험의 HTTP 서버가 받는다
// (CAIRN_PUSH_EXTRA_ORIGINS로 그 출처만 허락). 받은 본문을 브라우저처럼 풀어 내용을 본다.

type Json = Record<string, unknown>;
type Received = { path: string; headers: IncomingMessage['headers']; body: Buffer };

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
let db: Database;
let job: NoticePushJob;
let push: Server;
let origin: string;
const received: Received[] = [];
/** 가짜 푸시 서비스의 답 (주소마다). 없으면 201 */
const answers = new Map<string, number>();

/** 브라우저 하나: P-256 키와 auth, 구독 주소 */
function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const path = `/push/${randomUUID()}`;
  return {
    ecdh,
    auth,
    path,
    subscription: {
      endpoint: `${origin}${path}`,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: auth.toString('base64url'),
      },
    },
  };
}

/** 받은 푸시를 그 브라우저의 키로 푼다 (RFC 8291) */
function open(body: Buffer, b: ReturnType<typeof browser>): Json {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const shared = b.ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), b.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, b.auth, info, 32));
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
  return JSON.parse(plain.subarray(0, -1).toString()) as Json;
}

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.status === 204 ? {} : res.json();
}

const subscribe = (b: ReturnType<typeof browser>) =>
  api.request('POST', '/api/push/subscriptions', owner, b.subscription);
const subscriptions = async () => Number(ok(await api.get('/api/push/key', owner)).subscriptions);
const to = (b: ReturnType<typeof browser>) => received.filter((r) => r.path === b.path);

before(async () => {
  push = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(answers.get(req.url ?? '') ?? 201).end();
    });
  });
  await new Promise<void>((done) => push.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(push.address() as AddressInfo).port}`;
  process.env.CAIRN_PUSH_EXTRA_ORIGINS = origin;
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  job = api.service(NoticePushJob);
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'push-writer')}` };
});

after(async () => {
  await api.close();
  push.close();
  delete process.env.CAIRN_PUSH_EXTRA_ORIGINS;
});

/** 앞 시험의 알림은 이미 다룬 것으로: 이번 시험이 만든 알림만 보내게 */
beforeEach(async () => {
  await db.sql`UPDATE platform.notifications SET push_sent_at = now() WHERE push_sent_at IS NULL`;
});

describe('브라우저 푸시 (/api/push)', () => {
  test('방문자와 write 기기는 키도 구독도 보내 보기도 못한다 (403)', async () => {
    const b = browser();
    for (const headers of [{}, writer]) {
      const key = await api.request('GET', '/api/push/key', TestUser.visitor, undefined, headers);
      assert.equal(key.status, 403, key.text);
      for (const path of ['/api/push/subscriptions', '/api/push/test']) {
        const res = await api.request('POST', path, TestUser.visitor, b.subscription, headers);
        assert.equal(res.status, 403, `${path} ${res.text}`);
      }
    }
  });

  test('공개 키는 서버 키에서 만든 P-256 키라 늘 같다', async () => {
    const one = ok(await api.get('/api/push/key', owner));
    const two = ok(await api.get('/api/push/key', owner));
    assert.equal(Buffer.from(String(one.publicKey), 'base64url').length, 65);
    assert.equal(one.publicKey, two.publicKey);
  });

  test('알려진 푸시 서비스의 https 주소만 받고, 키의 모양을 본다', async () => {
    const b = browser();
    const as = (endpoint: string, keys = b.subscription.keys) =>
      api.request('POST', '/api/push/subscriptions', owner, { endpoint, keys });
    assert.equal((await as('https://evil.example.com/push/1')).status, 422);
    assert.equal((await as('http://fcm.googleapis.com/fcm/send/1')).status, 422);
    assert.equal((await as('not a url')).status, 422);
    assert.equal((await as(b.subscription.endpoint, { p256dh: 'AAAA', auth: 'AAAA' })).status, 422);
    assert.equal((await api.request('POST', '/api/push/subscriptions', owner, {})).status, 400);
  });

  test('구독하고 보내 보기: VAPID 머리글과 aes128gcm 본문이 그 브라우저의 키로 풀린다', async () => {
    const b = browser();
    const before = await subscriptions();
    ok(await subscribe(b), 204);
    ok(await subscribe(b), 204);
    assert.equal(await subscriptions(), before + 1, '같은 브라우저는 한 줄');
    const sent = ok(
      await api.request('POST', '/api/push/test', owner, { endpoint: b.subscription.endpoint }),
    );
    assert.deepEqual(sent, { sent: 1, failed: 0 });
    const [got] = to(b);
    const { publicKey } = ok(await api.get('/api/push/key', owner));
    assert.match(String(got?.headers.authorization), new RegExp(`^vapid t=[^,]+, k=${publicKey}$`));
    assert.equal(got?.headers['content-encoding'], 'aes128gcm');
    assert.equal(got?.headers.ttl, String(24 * 60 * 60));
    assert.equal(open(got?.body as Buffer, b).title, 'Cairn 알림 시험');

    const missing = await api.request('POST', '/api/push/test', owner, {
      endpoint: `${origin}/push/none`,
    });
    assert.equal(missing.status, 404);
    ok(
      await api.request('POST', '/api/push/subscriptions/delete', owner, {
        endpoint: b.subscription.endpoint,
      }),
      204,
    );
    assert.equal(await subscriptions(), before);
  });

  test('일꾼: 즉시 알림을 한 번만 푸시로 보내고, 사라진 구독(410)은 지운다', async () => {
    const b = browser();
    ok(await subscribe(b), 204);
    ok(
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: '푸시 시험 기기',
      }),
      201,
    );
    await Promise.all([job.run(), job.run()]);
    const pushed = to(b).map((r) => open(r.body, b));
    assert.equal(pushed.length, 1, '두 번 돌아도 한 번');
    assert.equal(pushed[0]?.title, '새 기기를 연결했어요');
    assert.equal(pushed[0]?.link, '/admin/devices');
    await job.run();
    assert.equal(to(b).length, 1, '다룬 알림은 다시 보내지 않는다');

    answers.set(b.path, 410);
    const before = await subscriptions();
    ok(
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: '푸시 시험 기기 2',
      }),
      201,
    );
    await job.run();
    assert.equal(await subscriptions(), before - 1, '410이면 구독을 지운다');
  });

  test('경로가 알림 센터만이면 보내지 않고 다룬 것으로 적는다', async () => {
    const b = browser();
    ok(await subscribe(b), 204);
    const settings = ok(await api.get('/api/notice-settings', owner));
    ok(
      await api.request('PUT', '/api/notice-settings', owner, {
        digest: 'hourly',
        digestTime: '09:00',
        timeZone: 'UTC',
        routes: { 'account.device.connected': 'center' },
        version: settings.version,
      }),
    );
    ok(
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: '알림 센터만',
      }),
      201,
    );
    await job.run();
    assert.equal(to(b).length, 0);
    const [left] = await db.sql`
      SELECT count(*)::int AS n FROM platform.notifications
      WHERE kind = 'account.device.connected' AND push_sent_at IS NULL`;
    assert.equal(left?.n, 0);
    const now = ok(await api.get('/api/notice-settings', owner));
    ok(
      await api.request('PUT', '/api/notice-settings', owner, {
        digest: 'hourly',
        digestTime: '09:00',
        timeZone: 'UTC',
        routes: {},
        version: now.version,
      }),
    );
  });
});
