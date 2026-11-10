import { lookup } from 'node:dns/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo, BlockList, connect, isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { AllowList } from './allow-list';

/** 허용 목록에는 있지만 나가면 안 되는 곳 (내부 주소로 풀림). 403으로 거절한다 */
export class Refused extends Error {}

/** 목적지에 TCP로 붙는다. 시험은 가짜 목적지로 바꿔 끼운다 */
export type Dial = (host: string, port: number) => Promise<Socket>;

// 코드 러너 칸의 나가는 프록시 (docs/코드작업.md 2 · 6장). 칸은 바깥으로 나가는 길이 없는 내부망에만 있고,
// 바깥에는 이 프록시를 거쳐서만 닿는다. 하는 일은 HTTPS 터널(CONNECT)을 허용 목록의 호스트로만 여는 것뿐이다:
//   - 평문 HTTP · 프록시 GET은 받지 않는다 (405)
//   - 443 포트만, IP 주소로 직접은 안 된다 (목록을 돌아가지 못하게)
//   - 이름이 내부 주소로 풀리면 거절한다: 이 프록시는 내부망에도 붙어 있어, 거르지 않으면 DB 같은 내부 서비스로 가는 문이 된다
// 목적지는 프록시가 정한다. 칸이 터널 안의 TLS에서 다른 이름을 대도 연결은 CONNECT에 적힌 곳으로만 간다.
// 터널 안은 암호화돼 있어 경로 · 내용을 보지 않는다. 기록은 호스트와 허용 · 거절만 남긴다.
export class EgressProxy {
  /** 터널을 여는 유일한 포트 (HTTPS) */
  static readonly PORT = 443;
  private static readonly CONNECT_MS = 10_000;
  /** 오가는 것이 없으면 터널을 닫는 시간 (긴 clone · 설치도 바이트가 오가는 동안은 이어진다) */
  private static readonly IDLE_MS = 10 * 60_000;
  private static readonly MAX_CONNECTIONS = 256;
  /** 나가면 안 되는 주소: 사설 · 루프백 · 링크 로컬 · 공유 · 멀티캐스트 · 예약 대역 */
  private static readonly INTERNAL = EgressProxy.internalRanges();

  private readonly server: Server;

  constructor(
    private readonly allow: AllowList,
    private readonly log: (line: string) => void,
    private readonly dial: Dial = EgressProxy.dialPublic,
  ) {
    this.server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('HTTPS 터널(CONNECT)만 받아요\n');
    });
    this.server.maxConnections = EgressProxy.MAX_CONNECTIONS;
    this.server.on('connect', (req: IncomingMessage, client: Duplex, head: Buffer) => {
      void this.tunnel(req.url ?? '', client, head);
    });
  }

  async listen(port: number, host = '0.0.0.0'): Promise<AddressInfo> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    return this.server.address() as AddressInfo;
  }

  /** 새 연결을 받지 않고, 열린 터널도 끊는다 */
  async close(): Promise<void> {
    const closed = new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.server.closeAllConnections();
    await closed;
  }

  /** CONNECT 대상 "host:port"를 읽는다. IPv6는 "[::1]:443". 모양이 틀리면 null */
  static target(url: string): { host: string; port: number } | null {
    const match =
      /^\[([0-9a-f:.]+)\]:(\d{1,5})$/i.exec(url) ?? /^([a-z0-9.-]+):(\d{1,5})$/i.exec(url);
    const port = Number(match?.[2]);
    if (!match?.[1] || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
    return { host: match[1], port };
  }

  /** 거절할 이유. 없으면 null (이름이 어디로 풀리는지는 붙을 때 본다) */
  refusal(host: string, port: number): string | null {
    if (port !== EgressProxy.PORT) return `${EgressProxy.PORT} 포트만 열어요`;
    if (isIP(host) !== 0) return 'IP 주소로 직접은 안 돼요';
    if (!this.allow.allows(host)) return '허용 목록에 없어요';
    return null;
  }

  /** 내부 주소인가. IPv4를 담은 IPv6(::ffff:10.0.0.1)는 IPv4로 본다 */
  static isInternal(address: string): boolean {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
    if (mapped) return EgressProxy.INTERNAL.check(mapped, 'ipv4');
    const family = isIP(address);
    if (family === 0) return true;
    return EgressProxy.INTERNAL.check(address, family === 6 ? 'ipv6' : 'ipv4');
  }

  /** 기본 dial: 이름을 풀어 바깥 주소일 때만 붙는다 */
  static async dialPublic(host: string, port: number): Promise<Socket> {
    const { address } = await lookup(host);
    if (EgressProxy.isInternal(address)) throw new Refused(`내부 주소로 풀려요 (${address})`);
    return new Promise<Socket>((resolve, reject) => {
      const socket = connect({ host: address, port });
      socket.setTimeout(EgressProxy.CONNECT_MS, () =>
        socket.destroy(new Error('연결 시간이 지났어요')),
      );
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.off('error', reject);
        socket.setTimeout(0);
        resolve(socket);
      });
    });
  }

  private async tunnel(url: string, client: Duplex, head: Buffer): Promise<void> {
    client.on('error', () => client.destroy());
    const target = EgressProxy.target(url);
    const why = target ? this.refusal(target.host, target.port) : '주소 모양이 틀려요';
    if (!target || why) return this.refuse(client, target ? 403 : 400, url, why ?? '');
    let upstream: Socket;
    try {
      upstream = await this.dial(target.host, target.port);
    } catch (error) {
      const refused = error instanceof Refused;
      return this.refuse(client, refused ? 403 : 502, url, (error as Error).message);
    }
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    this.log(`허용 ${url}`);
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) upstream.write(head);
    upstream.setTimeout(EgressProxy.IDLE_MS, () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
  }

  private refuse(client: Duplex, status: 400 | 403 | 502, url: string, why: string): void {
    this.log(`거절 ${url} (${why})`);
    const reason = { 400: 'Bad Request', 403: 'Forbidden', 502: 'Bad Gateway' }[status];
    client.end(
      `HTTP/1.1 ${status} ${reason}\r\ncontent-type: text/plain; charset=utf-8\r\n\r\n${why}\n`,
    );
  }

  private static internalRanges(): BlockList {
    const list = new BlockList();
    for (const [net, prefix] of [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ] as const)
      list.addSubnet(net, prefix, 'ipv4');
    for (const [net, prefix] of [
      ['::', 128],
      ['::1', 128],
      ['64:ff9b::', 96],
      ['fc00::', 7],
      ['fe80::', 10],
      ['ff00::', 8],
    ] as const)
      list.addSubnet(net, prefix, 'ipv6');
    return list;
  }
}
