// 시험용 가짜 Cairn 블로그 (127.0.0.1에만 뜬다). MCP 도구 부름을 적어 두고 정해 둔 답을 준다.
//   POST /mcp         Bearer 토큰이 맞아야 한다 (아니면 401). tools/call → structuredContent
//   GET  /admin · /admin/...   콘솔과 맡긴 뒤 열리는 대화 화면 대신
import { createServer } from 'node:http';

export const ACCESS_TOKEN = 'e2e-access';

const ANSWERS = {
  save_transcript: () => ({ session_id: 'session-1', status: 'saved', seq: 1, warnings: [] }),
  keep_page: () => ({ item_id: 'item-1', status: 'saved' }),
  ask_agent: () => ({ id: 'chat-1', title: '맡긴 일' }),
  inbox: () => ({ approvals: 2, questions: 1 }),
};

export class FakeCairn {
  constructor() {
    /** 받은 도구 부름 { name, arguments } */
    this.calls = [];
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(() => res.writeHead(500).end());
    });
  }

  async start() {
    await new Promise((done) => this.server.listen(0, '127.0.0.1', done));
    this.site = `http://127.0.0.1:${this.server.address().port}`;
    return this;
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise((done) => this.server.close(done));
  }

  /** 도구 하나로 온 인자들 */
  argumentsOf(name) {
    return this.calls.filter((call) => call.name === name).map((call) => call.arguments);
  }

  async handle(req, res) {
    if (req.method === 'GET' && /^\/admin(\/|$)/.test(req.url)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>콘솔</title><p>콘솔</p>');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const { name, arguments: args } = body.params;
    this.calls.push({ name, arguments: args });
    const answer = ANSWERS[name];
    const result = answer
      ? { structuredContent: answer(args), content: [{ type: 'text', text: '{}' }] }
      : {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ code: 'unknown', message: name }) }],
        };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  }
}
