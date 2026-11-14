import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

// 시험용 가짜 Chrome 원격 조종(CDP): /json/list와 탭의 웹소켓만. 받은 명령을 모아 두고 정해진 답을 돌려준다.
// 웹소켓은 글자 틀만 다룬다 (클라이언트 틀은 가려져 오고, 서버 틀은 가리지 않는다. RFC 6455).

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class FakeCdp {
  /** 탭이 받은 명령 (순서대로) */
  readonly calls: { tab: string; method: string; params: Record<string, unknown> }[] = [];
  /** /json/list가 돌려줄 대상 */
  targets: { id: string; type: string; title: string; url: string }[] = [
    { id: 'A'.repeat(32), type: 'page', title: '첫 탭', url: 'https://example.com/' },
    { id: 'B'.repeat(32), type: 'page', title: '도구', url: 'devtools://devtools/inspector.html' },
    { id: 'C'.repeat(32), type: 'service_worker', title: '일꾼', url: 'https://example.com/sw.js' },
    { id: 'D'.repeat(32), type: 'page', title: '둘째 탭', url: 'https://example.org/' },
  ];

  private constructor(private readonly server: Server) {}

  static async start(): Promise<FakeCdp> {
    const server = createServer();
    const fake = new FakeCdp(server);
    server.on('request', (req, res) => {
      if (req.url !== '/json/list') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(fake.targets));
    });
    server.on('upgrade', (req, socket) =>
      fake.accept(String(req.url), String(req.headers['sec-websocket-key']), socket),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return fake;
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private accept(url: string, key: string, socket: Duplex): void {
    const tab = url.replace('/devtools/page/', '');
    const accept = createHash('sha1')
      .update(key + GUID)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const frame = FakeCdp.read(buffer);
        if (!frame) return;
        buffer = buffer.subarray(frame.size);
        if (frame.opcode === 8) {
          socket.end();
          return;
        }
        const message = JSON.parse(frame.text) as {
          id: number;
          method: string;
          params: Record<string, unknown>;
        };
        this.calls.push({ tab, method: message.method, params: message.params });
        socket.write(
          FakeCdp.frame(JSON.stringify({ id: message.id, ...FakeCdp.answer(message.method) })),
        );
      }
    });
    socket.on('error', () => undefined);
  }

  private static answer(method: string): object {
    if (method === 'Page.getLayoutMetrics')
      return { result: { cssVisualViewport: { clientWidth: 1280.4, clientHeight: 720 } } };
    if (method === 'Page.captureScreenshot')
      return { result: { data: Buffer.from('jpeg').toString('base64') } };
    if (method === 'Page.getNavigationHistory')
      return { result: { currentIndex: 1, entries: [{ id: 11 }, { id: 12 }] } };
    if (method === 'Page.navigate') return { error: { message: 'Cannot navigate to invalid URL' } };
    return { result: {} };
  }

  /** 가려진 클라이언트 틀 하나. 다 오지 않았으면 null */
  private static read(b: Buffer): { opcode: number; text: string; size: number } | null {
    if (b.length < 2) return null;
    const opcode = (b[0] ?? 0) & 0x0f;
    let length = (b[1] ?? 0) & 0x7f;
    let at = 2;
    if (length === 126) {
      if (b.length < 4) return null;
      length = b.readUInt16BE(2);
      at = 4;
    } else if (length === 127) {
      if (b.length < 10) return null;
      length = Number(b.readBigUInt64BE(2));
      at = 10;
    }
    if (b.length < at + 4 + length) return null;
    const mask = b.subarray(at, at + 4);
    const body = Buffer.from(b.subarray(at + 4, at + 4 + length));
    for (let i = 0; i < body.length; i++) body[i] = (body[i] ?? 0) ^ (mask[i % 4] ?? 0);
    return { opcode, text: body.toString('utf8'), size: at + 4 + length };
  }

  /** 가리지 않은 서버 글자 틀 */
  private static frame(text: string): Buffer {
    const body = Buffer.from(text, 'utf8');
    const head =
      body.length < 126
        ? Buffer.from([0x81, body.length])
        : Buffer.concat([
            Buffer.from([0x81, 126]),
            Buffer.from([body.length >> 8, body.length & 0xff]),
          ]);
    return Buffer.concat([head, body]);
  }
}
