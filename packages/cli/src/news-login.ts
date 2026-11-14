import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SiteAddress } from './cairn-site';
import type { Shell } from './shell';
import { CliError, type Terminal } from './terminal';

/** 소식 기기의 열쇠 (~/.cairn/credentials.json의 news). 토큰은 화면에 찍지 않는다 */
export class NewsCredential {
  constructor(
    readonly site: string,
    readonly mcp: string,
    readonly tokenEndpoint: string,
    readonly clientId: string,
    readonly device: string,
    readonly accessToken: string,
    readonly refreshToken: string,
    readonly expiresAt: Date,
  ) {}

  /** credentials.json에 쓰는 모양 (훅 · 상태 줄의 news-access.mjs가 읽는다) */
  toJSON(): object {
    return {
      site: this.site,
      mcp: this.mcp,
      token_endpoint: this.tokenEndpoint,
      client_id: this.clientId,
      device: this.device,
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expires_at: this.expiresAt.toISOString(),
    };
  }
}

/** 브라우저가 돌아올 이 컴퓨터의 주소 (127.0.0.1의 빈 포트). 한 번 받으면 닫는다 */
class LoopbackCallback {
  private constructor(
    private readonly server: Server,
    private readonly answer: Promise<URLSearchParams>,
  ) {}

  static async open(): Promise<LoopbackCallback> {
    let deliver: (query: URLSearchParams) => void = () => {};
    const answer = new Promise<URLSearchParams>((done) => {
      deliver = done;
    });
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const ok = url.searchParams.has('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Cairn</title><p>${ok ? '소식 기기를 연결했어요. 이 창을 닫아도 돼요.' : '연결하지 못했어요. 터미널을 봐 주세요.'}</p>`,
      );
      deliver(url.searchParams);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return new LoopbackCallback(server, answer);
  }

  get uri(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/callback`;
  }

  /** 돌아온 값. waitMs 안에 오지 않으면 CliError */
  async wait(waitMs: number): Promise<URLSearchParams> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, fail) => {
      timer = setTimeout(
        () =>
          fail(
            new CliError(
              '소식 기기 승인을 기다리다 그만뒀어요. cairn connect를 다시 실행해 주세요',
            ),
          ),
        waitMs,
      );
    });
    try {
      return await Promise.race([this.answer, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    this.server.close();
    this.server.closeAllConnections();
  }
}

// 소식 기기 만들기 (2차 1-3): 블로그의 OAuth(PKCE)로 scope=news를 요청한다. 스스로 등록 → 브라우저로 승인 화면 →
// 이 컴퓨터(127.0.0.1)로 돌아온 코드 → 토큰. 승인 화면은 "소식 읽기"만 보이고, 승인하면 그 권한만 가진 기기가 생긴다.
// 블로그가 news를 모르는 옛 버전이면 넓은 권한의 토큰을 받게 되므로, 받은 권한이 news가 아니면 버리고 멈춘다.
export class NewsLogin {
  static readonly SCOPE = 'news';
  private static readonly WAIT_MS = 5 * 60_000;
  private static readonly TIMEOUT_MS = 10_000;

  constructor(
    private readonly terminal: Terminal,
    private readonly shell: Shell,
    private readonly waitMs = NewsLogin.WAIT_MS,
  ) {}

  async run(at: SiteAddress, device: string): Promise<NewsCredential> {
    const meta = await this.json(`${at.site}/.well-known/oauth-authorization-server`);
    const endpoint = (key: string) => {
      const value = meta[key];
      if (typeof value !== 'string') throw new CliError(`블로그의 OAuth 안내에 ${key}가 없어요`);
      return value;
    };
    const callback = await LoopbackCallback.open();
    try {
      const client = await this.json(endpoint('registration_endpoint'), {
        client_name: device,
        redirect_uris: [callback.uri],
      });
      const clientId = String(client.client_id ?? '');
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(16).toString('base64url');
      const url = new URL(endpoint('authorization_endpoint'));
      for (const [key, value] of Object.entries({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: callback.uri,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        state,
        scope: NewsLogin.SCOPE,
      }))
        url.searchParams.set(key, value);
      this.terminal.say(`브라우저에서 소식 기기 "${device}"를 승인해 주세요 (권한: 소식 읽기만).`);
      this.terminal.say(`  열리지 않으면 이 주소: ${url}`);
      await this.shell.openBrowser(url.toString());
      const back = await callback.wait(this.waitMs);
      if (back.get('state') !== state) throw new CliError('승인 응답이 이 요청의 것이 아니에요');
      const issuer = back.get('iss');
      if (issuer && issuer !== meta.issuer)
        throw new CliError('다른 블로그가 보낸 승인 응답이에요');
      if (back.get('error'))
        throw new CliError(
          `소식 기기를 만들지 못했어요: ${back.get('error_description') ?? back.get('error')}`,
        );
      const token = await this.form(endpoint('token_endpoint'), {
        grant_type: 'authorization_code',
        code: back.get('code') ?? '',
        redirect_uri: callback.uri,
        client_id: clientId,
        code_verifier: verifier,
      });
      if (token.scope !== NewsLogin.SCOPE) {
        const revoke =
          typeof meta.revocation_endpoint === 'string' ? meta.revocation_endpoint : null;
        if (revoke)
          for (const key of ['refresh_token', 'access_token'])
            await this.form(revoke, { token: String(token[key] ?? '') }).catch(() => ({}));
        throw new CliError(
          '블로그가 소식 기기를 모르는 버전이에요. 서버를 새 버전으로 올린 뒤 cairn connect를 다시 실행해 주세요',
        );
      }
      return new NewsCredential(
        at.site,
        at.mcp,
        endpoint('token_endpoint'),
        clientId,
        device,
        String(token.access_token ?? ''),
        String(token.refresh_token ?? ''),
        new Date(Date.now() + Number(token.expires_in ?? 3600) * 1000),
      );
    } finally {
      callback.close();
    }
  }

  /** GET(본문 없음)이나 JSON POST. OAuth 오류면 그 설명으로 CliError */
  private async json(url: string, body?: object): Promise<Record<string, unknown>> {
    return this.send(url, {
      method: body ? 'POST' : 'GET',
      ...(body
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
  }

  private async form(
    url: string,
    values: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    return this.send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString(),
    });
  }

  private async send(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(NewsLogin.TIMEOUT_MS) });
    } catch (error) {
      throw new CliError(
        `블로그에 닿지 않아요: ${new URL(url).origin} (${(error as Error).message})`,
      );
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const why = body.error_description ?? body.message ?? body.error ?? res.status;
      throw new CliError(`소식 기기를 만들지 못했어요: ${String(why)}`);
    }
    return body;
  }
}
