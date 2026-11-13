import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { BaseGateway, ExternalFailure, RuleViolation } from '../../platform';
import { HtmlText } from './html-text';

/** 받아 온 페이지 한 장 (글자만) */
export class WebPage {
  constructor(
    readonly url: string,
    readonly title: string,
    readonly text: string,
    readonly truncated: boolean,
    readonly contentType: string,
  ) {}
}

// 서버가 AI 대신 주소 하나를 열어 글자만 돌려준다 (read_url).
// 서버가 대신 여는 것이라 내부망을 들여다보는 길이 되지 않게: 이름을 풀어 나온 주소가 하나라도 내부 · 이 서버면 열지 않고,
// 확인한 그 주소로만 붙는다 (확인한 뒤 이름이 다른 주소로 바뀌어도 따라가지 않게). 리다이렉트는 MAX_HOPS번까지, 매번 다시 확인한다.
// 한도: 받기 MAX_BYTES (넘으면 앞부분만), AI에게 주는 글자 TEXT_MAX, 시간 timeoutMs. 글자가 아닌 형식(PDF · 그림)은 열지 않는다.
export class WebPageGateway extends BaseGateway {
  /** 시험에서만: 127.0.0.1 · ::1의 가짜 사이트를 열게 한다 (운영에서 켜지 않는다) */
  static readonly TEST_LOOPBACK_ENV = 'CAIRN_READ_URL_TEST_LOOPBACK';
  static readonly MAX_HOPS = 3;
  static readonly MAX_BYTES = 2 * 1024 * 1024;
  static readonly TEXT_MAX = 60_000;
  protected readonly name = '웹 페이지';
  protected override readonly timeoutMs = 15_000;
  private static readonly TEXT_TYPES =
    /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json|rss\+xml|atom\+xml)\b)/i;
  private static readonly HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/i;
  private static readonly AGENT = 'Mozilla/5.0 (compatible; CairnReader/1.0; +read_url)';
  private static readonly BLOCKED = WebPageGateway.blockList();
  private static readonly LOOPBACK = WebPageGateway.loopbackList();

  /** 주소 하나를 연다. allow는 주소마다(리다이렉트 포함) 목줄을 묻는다 (안 되면 던진다) */
  async read(start: URL, allow: (url: URL) => void): Promise<WebPage> {
    let url = start;
    for (let hop = 0; hop <= WebPageGateway.MAX_HOPS; hop++) {
      allow(url);
      const address = await this.resolve(url.hostname);
      const res = await this.call((signal) => this.get(url, address, signal));
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        url = new URL(location, url);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new ExternalFailure(`열지 못했어요 (HTTP ${status})`);
      }
      return this.page(url, res);
    }
    throw new RuleViolation(`다른 주소로 ${WebPageGateway.MAX_HOPS}번 넘게 넘어가요`);
  }

  /** 이름을 풀어 쓸 주소 하나. 나온 주소 중 하나라도 막힌 곳이면 열지 않는다 */
  private async resolve(hostname: string): Promise<LookupAddress> {
    const host = hostname.replace(/^\[|\]$/g, '');
    const family = isIP(host);
    const found: LookupAddress[] = family
      ? [{ address: host, family }]
      : await lookup(host, { all: true, verbatim: true }).catch(() => {
          throw new ExternalFailure(`주소를 찾지 못했어요 (${host})`);
        });
    for (const a of found)
      if (WebPageGateway.blocked(a.address))
        throw new RuleViolation('내부망 · 이 서버의 주소는 열 수 없어요');
    const [first] = found;
    if (!first) throw new ExternalFailure(`주소를 찾지 못했어요 (${host})`);
    return first;
  }

  private get(url: URL, address: LookupAddress, signal: AbortSignal): Promise<IncomingMessage> {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(
        url,
        {
          method: 'GET',
          signal,
          headers: {
            'user-agent': WebPageGateway.AGENT,
            accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
            'accept-language': 'ko,en;q=0.8',
          },
          // 확인한 주소로만 붙는다. 인증서는 원래 이름으로 확인한다 (url의 호스트를 그대로 둔다)
          lookup: (_name, options, done) => {
            if ((options as { all?: boolean }).all) done(null, [address]);
            else done(null, address.address, address.family);
          },
        },
        resolve,
      );
      req.on('error', reject);
      req.end();
    });
  }

  private async page(url: URL, res: IncomingMessage): Promise<WebPage> {
    const type = String(res.headers['content-type'] ?? 'text/html');
    if (!WebPageGateway.TEXT_TYPES.test(type)) {
      res.resume();
      throw new RuleViolation(
        `글이 아닌 형식이에요 (${type.split(';')[0]}). 파일은 주인이 재료로 올려야 해요`,
      );
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let cut = false;
    for await (const chunk of res as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= WebPageGateway.MAX_BYTES) {
        cut = true;
        res.destroy();
        break;
      }
    }
    const bytes = Buffer.concat(chunks).subarray(0, WebPageGateway.MAX_BYTES);
    const html = WebPageGateway.HTML_TYPES.test(type);
    const raw = WebPageGateway.decode(bytes, type, html);
    const title = html ? HtmlText.title(raw) : '';
    const body = html ? HtmlText.body(raw) : raw.trim();
    const short = body.length > WebPageGateway.TEXT_MAX;
    return new WebPage(
      url.toString(),
      title,
      short ? body.slice(0, WebPageGateway.TEXT_MAX) : body,
      cut || short,
      (type.split(';')[0] ?? '').trim().toLowerCase(),
    );
  }

  /** 머리글 · <meta>의 문자 집합으로 (euc-kr 같은 옛 한국어 페이지). 모르는 이름이면 utf-8 */
  private static decode(bytes: Buffer, type: string, html: boolean): string {
    const label =
      /charset=["']?([\w-]+)/i.exec(type)?.[1] ??
      (html ? HtmlText.metaCharset(bytes.subarray(0, 4096).toString('latin1')) : null) ??
      'utf-8';
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  private static blocked(address: string): boolean {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    const ip = mapped ?? address;
    const type = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
    if (
      process.env[WebPageGateway.TEST_LOOPBACK_ENV] === '1' &&
      WebPageGateway.LOOPBACK.check(ip, type)
    )
      return false;
    return WebPageGateway.BLOCKED.check(ip, type);
  }

  /** 밖의 공개 주소가 아닌 곳: 사설 · 루프백 · 링크 로컬(클라우드 메타데이터) · CGNAT(Tailscale) · 멀티캐스트 · 예약 */
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

  private static loopbackList(): BlockList {
    const list = new BlockList();
    list.addSubnet('127.0.0.0', 8, 'ipv4');
    list.addAddress('::1', 'ipv6');
    return list;
  }
}
