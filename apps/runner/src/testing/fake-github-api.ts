import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** 받은 요청 하나 (시험이 본다) */
export class FakeGithubCall {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly authorization: string,
    readonly body: Record<string, unknown> | null,
  ) {}
}

// 시험용 GitHub REST (러너의 GitHubPulls가 쓰는 PR 세 갈래만): 열린 PR 찾기 · 열기 · 본문 고치기.
// 이 컴퓨터의 127.0.0.1에서만 열고, 받은 요청을 남긴다. 토큰은 확인만 한다 (틀리면 401).
export class FakeGithubApi {
  readonly calls: FakeGithubCall[] = [];
  private readonly pulls: {
    number: number;
    head: string;
    base: string;
    body: string;
    draft: boolean;
  }[] = [];

  private constructor(
    private readonly server: Server,
    readonly url: string,
    private readonly token: string,
  ) {}

  static async start(token: string): Promise<FakeGithubApi> {
    let fake: FakeGithubApi | null = null;
    const server = createServer((req, res) => void fake?.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    fake = new FakeGithubApi(server, `http://127.0.0.1:${port}`, token);
    return fake;
  }

  /** 열린 PR들 (번호 · 브랜치 · draft) */
  get open(): readonly { number: number; head: string; base: string; draft: boolean }[] {
    return this.pulls;
  }

  close(): void {
    this.server.close();
    this.server.closeAllConnections();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const authorization = String(req.headers.authorization ?? '');
    this.calls.push(new FakeGithubCall(req.method ?? '', url.pathname, authorization, body));
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (authorization !== `Bearer ${this.token}`) return send(401, { message: 'Bad credentials' });
    const match = /^\/repos\/([^/]+)\/([^/]+)\/pulls(?:\/(\d+))?$/.exec(url.pathname);
    if (!match) return send(404, { message: 'Not Found' });
    const [, owner, name, number] = match;
    const html = (n: number) => `https://github.example/${owner}/${name}/pull/${n}`;
    if (req.method === 'GET' && !number) {
      const head = url.searchParams.get('head') ?? '';
      const found = this.pulls.filter((p) => `${owner}:${p.head}` === head);
      return send(
        200,
        found.map((p) => ({ number: p.number, html_url: html(p.number) })),
      );
    }
    if (req.method === 'POST' && !number && body) {
      const made = {
        number: this.pulls.length + 1,
        head: String(body.head),
        base: String(body.base),
        body: String(body.body ?? ''),
        draft: body.draft === true,
      };
      this.pulls.push(made);
      return send(201, { number: made.number, html_url: html(made.number) });
    }
    if (req.method === 'PATCH' && number && body) {
      const pull = this.pulls.find((p) => p.number === Number(number));
      if (!pull) return send(404, { message: 'Not Found' });
      pull.body = String(body.body ?? pull.body);
      return send(200, { number: pull.number, html_url: html(pull.number) });
    }
    send(405, { message: 'Method Not Allowed' });
  }
}
