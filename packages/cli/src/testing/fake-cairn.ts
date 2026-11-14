import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** 가짜 서버에 온 MCP 도구 호출 하나 */
export class ToolCall {
  constructor(
    readonly tool: string,
    readonly args: Record<string, unknown>,
    /** Bearer 토큰 */
    readonly token: string,
  ) {}
}

// 시험용 가짜 Cairn 블로그 (127.0.0.1): 소식 기기를 만드는 OAuth(등록 → 승인 → 토큰 · 갱신 · 버리기)와 MCP agent_updates.
// 승인 화면 대신 /oauth/authorize가 바로 코드를 붙여 돌려보낸다. agent_updates의 답은 시험이 정한다 (updates).
// 실제 서버의 규칙은 apps/server의 device.api.test.ts가 보고, 여기서는 cairn connect · 훅 · 상태 줄의 순서만 본다.
export class FakeCairn {
  readonly calls: ToolCall[] = [];
  readonly revoked: string[] = [];
  readonly refreshed: string[] = [];
  /** 승인 요청에 실려 온 scope */
  readonly asked: (string | null)[] = [];
  /** 토큰이 돌려줄 권한 (옛 서버처럼 news를 모르면 'upload read_public') */
  grantScope = 'news';
  /** agent_updates의 답. 함수면 부를 때마다 받은 인자로 만든다 */
  updates: (args: Record<string, unknown>) => object = () => ({ news: [], cursor: 0, board: [] });
  /** agent_updates를 거절할 때: 받은 인자로 거절(code, message)이나 null(받아 줌)을 정한다 */
  refuse: (args: Record<string, unknown>) => { code: string; message: string } | null = () => null;
  /** 답을 늦출 시간 (훅의 2초 한도를 볼 때) */
  delayMs = 0;
  /** 갱신을 거절한다 (갱신 토큰이 죽음) */
  refreshDead = false;
  /** 살아 있는 access 토큰 */
  private readonly live = new Set<string>();
  private readonly codes = new Map<string, { challenge: string; redirect: string }>();
  private server: Server | null = null;

  get origin(): string {
    return `http://127.0.0.1:${(this.server?.address() as AddressInfo | undefined)?.port ?? 0}`;
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => void this.route(req, res));
    this.server = server;
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  }

  close(): void {
    this.server?.close();
    this.server?.closeAllConnections();
  }

  /** 시험이 직접 넣는 토큰 (credentials.json을 손으로 쓸 때) */
  allow(token: string): void {
    this.live.add(token);
  }

  /** agent_updates 호출의 인자들 */
  get updateArgs(): Record<string, unknown>[] {
    return this.calls.filter((c) => c.tool === 'agent_updates').map((c) => c.args);
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.origin);
    const raw = await new Promise<string>((done) => {
      let text = '';
      req.on('data', (chunk) => {
        text += chunk;
      });
      req.on('end', () => done(text));
    });
    const json = (status: number, body: object) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const form = new URLSearchParams(raw);
    if (url.pathname === '/.well-known/oauth-authorization-server')
      return json(200, {
        issuer: this.origin,
        authorization_endpoint: `${this.origin}/oauth/authorize`,
        token_endpoint: `${this.origin}/oauth/token`,
        registration_endpoint: `${this.origin}/oauth/register`,
        revocation_endpoint: `${this.origin}/oauth/revoke`,
      });
    if (url.pathname === '/oauth/register')
      return json(201, { client_id: `cairn_${randomBytes(4).toString('hex')}` });
    if (url.pathname === '/oauth/authorize') {
      const q = url.searchParams;
      this.asked.push(q.get('scope'));
      const code = randomBytes(8).toString('hex');
      this.codes.set(code, {
        challenge: q.get('code_challenge') ?? '',
        redirect: q.get('redirect_uri') ?? '',
      });
      const back = new URL(q.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state') ?? '');
      back.searchParams.set('iss', this.origin);
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (url.pathname === '/oauth/token') return this.token(form, json);
    if (url.pathname === '/oauth/revoke') {
      this.revoked.push(form.get('token') ?? '');
      return json(200, {});
    }
    if (url.pathname === '/mcp') return this.mcp(req, raw, json);
    res.writeHead(404).end();
  }

  private token(form: URLSearchParams, json: (status: number, body: object) => void): void {
    if (form.get('grant_type') === 'refresh_token') {
      this.refreshed.push(form.get('refresh_token') ?? '');
      if (this.refreshDead) {
        json(400, { error: 'invalid_grant' });
        return;
      }
    } else {
      const code = this.codes.get(form.get('code') ?? '');
      const challenge = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url');
      if (!code || code.challenge !== challenge || code.redirect !== form.get('redirect_uri')) {
        json(400, { error: 'invalid_grant' });
        return;
      }
    }
    const access = `cairn_at_${randomBytes(16).toString('hex')}`;
    this.live.add(access);
    json(200, {
      access_token: access,
      refresh_token: `cairn_rt_${randomBytes(16).toString('hex')}`,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: this.grantScope,
    });
  }

  private async mcp(
    req: IncomingMessage,
    raw: string,
    json: (status: number, body: object) => void,
  ): Promise<void> {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!this.live.has(token)) return json(401, { error: 'invalid_token' });
    const { params } = JSON.parse(raw) as {
      params: { name: string; arguments: Record<string, unknown> };
    };
    this.calls.push(new ToolCall(params.name, params.arguments, token));
    if (this.delayMs > 0) await new Promise((done) => setTimeout(done, this.delayMs));
    const refused = this.refuse(params.arguments);
    if (refused)
      return json(200, {
        jsonrpc: '2.0',
        id: 1,
        result: { isError: true, content: [{ type: 'text', text: JSON.stringify(refused) }] },
      });
    json(200, {
      jsonrpc: '2.0',
      id: 1,
      result: { structuredContent: this.updates(params.arguments) },
    });
  }
}
