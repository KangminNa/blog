import { lookup } from 'node:dns/promises';
import {
  createServer,
  type IncomingMessage,
  request,
  type Server,
  type ServerResponse,
} from 'node:http';
import { type AddressInfo, BlockList, connect, isIP, type Socket } from 'node:net';

/** 막을 주소인가 (풀어 본 IP와 포트) */
export type AddressRule = (address: string, port: number) => boolean;

// 둘러보기(2차 3단계, 2026-11-14)의 나가는 길. 둘러보기 일의 새 빈 컨텍스트는 이 프록시로만 나간다 (Playwright MCP --proxy-server →
// 그 컨텍스트에만 걸리는 프록시, 다른 탭 · 로그인된 프로필은 그대로). 이름을 풀어 본 뒤 그 주소로만 붙어서
// 이 서버 · 내부망 · 메타데이터 · Tailscale(CGNAT) 주소를 막는다: 페이지가 리다이렉트 · 하위 요청으로 가도 같다.
// 브라우저 정책(URLBlocklist)은 이름 몇 개만 막을 수 있고 IP 대역을 적을 수 없어서 대역은 여기서 막는다.
// 프록시는 일마다 띄우고 끝나면 닫는다. 127.0.0.1에만 열린다 (서버 러너는 브라우저와 같은 네트워크다).
export class ExploreProxy {
  private static readonly BLOCKED = ExploreProxy.blockList();
  private static readonly REFUSED =
    'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n';

  private readonly sockets = new Set<Socket>();

  private constructor(
    private readonly server: Server,
    private readonly blocked: AddressRule,
  ) {}

  /** 127.0.0.1의 빈 포트로 띄운다. blocked는 시험만 바꾼다 */
  static async start(blocked: AddressRule = ExploreProxy.internal): Promise<ExploreProxy> {
    const server = createServer();
    const proxy = new ExploreProxy(server, blocked);
    server.on('request', (req, res) => void proxy.forward(req, res));
    server.on('connect', (req, socket, head) => void proxy.tunnel(req, socket as Socket, head));
    server.on('connection', (socket) => {
      proxy.sockets.add(socket);
      socket.once('close', () => proxy.sockets.delete(socket));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return proxy;
  }

  /** 브라우저에 줄 프록시 주소 */
  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((done) => this.server.close(done));
  }

  /** 밖의 공개 주소가 아닌 곳: 사설 · 루프백 · 링크 로컬(클라우드 메타데이터) · CGNAT(Tailscale) · 멀티캐스트 · 예약 */
  static internal(address: string): boolean {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    const ip = mapped ?? address;
    return ExploreProxy.BLOCKED.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
  }

  /** 이름을 풀어 붙을 주소 하나. 풀린 주소 가운데 하나라도 막을 곳이면 null (이름 하나로 안팎을 섞지 못하게) */
  private async target(host: string, port: number): Promise<string | null> {
    const bare = host.replace(/^\[|\]$/g, '');
    if (!bare || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
    const found = await lookup(bare, { all: true }).catch(() => []);
    if (found.length === 0 || found.some((a) => this.blocked(a.address, port))) return null;
    return found[0]?.address ?? null;
  }

  /** https(와 wss): CONNECT 호스트:포트 → 그 주소로 터널 */
  private async tunnel(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    socket.on('error', () => socket.destroy());
    const at = (req.url ?? '').lastIndexOf(':');
    const host = (req.url ?? '').slice(0, at);
    const port = Number((req.url ?? '').slice(at + 1));
    const address = at > 0 ? await this.target(host, port) : null;
    if (address === null) {
      socket.end(ExploreProxy.REFUSED);
      return;
    }
    const upstream = connect({ host: address, port }, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  }

  /** http: 주소 전체가 든 요청 → 그 주소로 보내고 답을 그대로 */
  private async forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = URL.canParse(req.url ?? '') ? new URL(req.url ?? '') : null;
    const port = url ? Number(url.port || 80) : 0;
    const address = url?.protocol === 'http:' ? await this.target(url.hostname, port) : null;
    if (url === null || address === null) {
      res
        .writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Cairn 둘러보기: 막힌 주소예요');
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const out = request(
      {
        host: address,
        port,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
        setHost: false,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    out.on('error', () => res.destroy());
    req.pipe(out);
  }

  private static blockList(): BlockList {
    const list = new BlockList();
    for (const [net, bits] of [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 3],
    ] as const)
      list.addSubnet(net, bits, 'ipv4');
    for (const [net, bits] of [
      ['::', 127],
      ['64:ff9b::', 96],
      ['100::', 64],
      ['2001:db8::', 32],
      ['fc00::', 7],
      ['fe80::', 10],
      ['ff00::', 8],
    ] as const)
      list.addSubnet(net, bits, 'ipv6');
    return list;
  }
}
