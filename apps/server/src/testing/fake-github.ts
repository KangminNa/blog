import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// 테스트용 가짜 GitHub (로그인 부분만). 실제 GitHub 대신 이 주소를 GitHub 앱에 등록해 로그인 흐름을 끝까지 돌린다.
//   POST /login/oauth/access_token  코드 "ok-<숫자>" → 토큰 "token-<숫자>", 그 밖의 코드는 거절
//   GET  /user                      토큰 "token-<숫자>" → 그 숫자 id의 사용자
export class FakeGithub {
  private constructor(
    private readonly server: Server,
    readonly url: string,
  ) {}

  static async start(): Promise<FakeGithub> {
    const server = createServer(async (req, res) => {
      const send = (status: number, body: object) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const code = String((JSON.parse(raw || '{}') as { code?: unknown }).code ?? '');
        const id = /^ok-(\d+)$/.exec(code)?.[1];
        return id
          ? send(200, { access_token: `token-${id}`, token_type: 'bearer' })
          : send(200, {
              error: 'bad_verification_code',
              error_description: 'The code passed is incorrect or expired.',
            });
      }
      if (req.method === 'GET' && req.url === '/user') {
        const id = /^Bearer token-(\d+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
        if (!id) return send(401, { message: 'Bad credentials' });
        return send(200, {
          id: Number(id),
          login: `user${id}`,
          name: `사용자 ${id}`,
          avatar_url: `https://avatars.example/${id}`,
        });
      }
      send(404, { message: 'Not Found' });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    return new FakeGithub(server, `http://127.0.0.1:${port}`);
  }

  close(): Promise<void> {
    return new Promise((done) => this.server.close(() => done()));
  }
}
