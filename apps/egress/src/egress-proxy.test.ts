import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';
import { AllowList } from './allow-list';
import { type Dial, EgressProxy, Refused } from './egress-proxy';

// 프록시를 127.0.0.1에 띄우고, 바깥 목적지 대신 받은 바이트를 그대로 돌려주는 가짜 서버에 붙인다 (네트워크 없이).

let upstream: Server;
let upstreamPort: number;
let proxy: EgressProxy;
let proxyPort: number;
const logs: string[] = [];
const dialed: string[] = [];
/** 이번 시험의 dial이 할 일. 기본은 가짜 목적지에 붙기 */
let dialBehavior: () => Promise<Socket>;

const toUpstream = async (): Promise<Socket> => {
  const socket = connect(upstreamPort, '127.0.0.1');
  await once(socket, 'connect');
  return socket;
};

before(async () => {
  upstream = createServer((socket) => socket.pipe(socket));
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamPort = (upstream.address() as { port: number }).port;
  const dial: Dial = async (host, port) => {
    dialed.push(`${host}:${port}`);
    return dialBehavior();
  };
  proxy = new EgressProxy(
    AllowList.parse('allowed.test\n.cdn.test'),
    (line) => logs.push(line),
    dial,
  );
  proxyPort = (await proxy.listen(0, '127.0.0.1')).port;
});

after(async () => {
  await proxy.close();
  upstream.close();
});

beforeEach(() => {
  logs.length = 0;
  dialed.length = 0;
  dialBehavior = toUpstream;
});

/** CONNECT를 보내고 응답 머리의 상태 코드를 읽는다. 터널이 열리면 그 소켓을 그대로 쓴다 */
async function connectVia(
  target: string,
): Promise<{ status: number; body: string; socket: Socket }> {
  const socket = connect(proxyPort, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  const text = await new Promise<string>((resolve) => {
    let seen = '';
    const onData = (chunk: Buffer) => {
      seen += chunk.toString('utf8');
      if (!seen.includes('\r\n\r\n')) return;
      socket.off('data', onData);
      resolve(seen);
    };
    socket.on('data', onData);
    socket.once('end', () => resolve(seen));
  });
  const [head = '', body = ''] = text.split('\r\n\r\n');
  return { status: Number(head.split(' ')[1]), body, socket };
}

describe('나가는 프록시', () => {
  test('허용 목록의 호스트로만 터널을 연다. 터널 안의 바이트는 그대로 오간다', async () => {
    const { status, socket } = await connectVia('allowed.test:443');
    assert.equal(status, 200);
    socket.write('ping');
    const [echoed] = (await once(socket, 'data')) as [Buffer];
    assert.equal(echoed.toString(), 'ping');
    socket.destroy();
    assert.deepEqual(dialed, ['allowed.test:443']);
    assert.deepEqual(logs, ['허용 allowed.test:443']);
  });

  test('하위 도메인 규칙의 이름도 연다', async () => {
    const { status, socket } = await connectVia('img.cdn.test:443');
    assert.equal(status, 200);
    socket.destroy();
  });

  test('목록에 없는 이름 · IP 직접 · 443이 아닌 포트는 붙어 보지도 않고 403', async () => {
    for (const target of [
      'evil.test:443',
      'allowed.test.evil.io:443',
      '140.82.112.3:443',
      '[::1]:443',
      'allowed.test:22',
      'allowed.test:80',
    ]) {
      const { status, socket } = await connectVia(target);
      assert.equal(status, 403, target);
      socket.destroy();
    }
    assert.deepEqual(dialed, []);
    assert.ok(logs.every((line) => line.startsWith('거절 ')));
  });

  test('주소 모양이 틀리면 400', async () => {
    for (const target of ['allowed.test', 'allowed.test:', 'allowed.test:99999', 'a b:443']) {
      const { status, socket } = await connectVia(target);
      assert.equal(status, 400, target);
      socket.destroy();
    }
  });

  test('이름이 내부 주소로 풀리면 403, 목적지에 닿지 못하면 502', async () => {
    dialBehavior = async () => {
      throw new Refused('내부 주소로 풀려요 (10.0.0.5)');
    };
    const inside = await connectVia('allowed.test:443');
    assert.equal(inside.status, 403);
    assert.match(inside.body, /내부 주소/);
    inside.socket.destroy();

    dialBehavior = async () => {
      throw new Error('연결 시간이 지났어요');
    };
    const down = await connectVia('allowed.test:443');
    assert.equal(down.status, 502);
    down.socket.destroy();
  });

  test('평문 HTTP · 프록시 GET은 405', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: proxyPort, path: 'http://allowed.test/', method: 'GET' },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 405);
    assert.deepEqual(dialed, []);
  });
});

describe('내부 주소 판단', () => {
  test('사설 · 루프백 · 링크 로컬(클라우드 메타데이터) · 공유 · Docker 대역은 내부', () => {
    for (const address of [
      '10.0.0.1',
      '172.20.0.5',
      '192.168.1.1',
      '127.0.0.1',
      '169.254.169.254',
      '100.64.1.1',
      '0.0.0.0',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:10.1.2.3',
      '::ffff:127.0.0.1',
      'not-an-ip',
    ])
      assert.equal(EgressProxy.isInternal(address), true, address);
  });

  test('바깥 주소는 내부가 아니다', () => {
    for (const address of ['140.82.112.3', '104.16.0.1', '2606:4700::1111', '::ffff:140.82.112.3'])
      assert.equal(EgressProxy.isInternal(address), false, address);
  });

  test('기본 dial은 내부 주소로 풀리는 이름에 붙지 않는다 (localhost)', async () => {
    await assert.rejects(EgressProxy.dialPublic('localhost', 443), Refused);
  });
});
