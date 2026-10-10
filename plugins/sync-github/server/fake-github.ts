import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

// 테스트용 가짜 GitHub. 동기화가 쓰는 API만 메모리 위에서 흉내 낸다 (blob sha는 진짜 git과 같은 방식).
export class FakeGithub {
  readonly blobs = new Map<string, Buffer>();
  readonly trees = new Map<string, Map<string, string>>();
  readonly commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  readonly refs = new Map<string, string>();
  isPrivate = true;
  private server: Server | null = null;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      void this.route(req).then(
        ([status, body]) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        },
        (e: Error) => {
          res.writeHead(500);
          res.end(e.message);
        },
      );
    });
    await new Promise<void>((r) => this.server?.listen(0, '127.0.0.1', r));
    const address = this.server.address();
    return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }

  /** 브랜치 맨 끝의 파일 내용 */
  filesAt(branch: string): Map<string, string> {
    const commit = this.commits.get(this.refs.get(branch) ?? '');
    const tree = this.trees.get(commit?.tree ?? '') ?? new Map();
    return new Map([...tree].map(([p, sha]) => [p, this.blobs.get(sha)?.toString('utf8') ?? '']));
  }

  /** 저장소에 아무 파일이나 미리 넣어 둔다 (README 등) */
  seed(branch: string, path: string, content: string): void {
    const blob = this.putBlob(Buffer.from(content));
    const base = this.trees.get(this.commits.get(this.refs.get(branch) ?? '')?.tree ?? '');
    const tree = this.putTree(new Map([...(base ?? []), [path, blob]]));
    const parents = this.refs.has(branch) ? [this.refs.get(branch) as string] : [];
    this.refs.set(branch, this.putCommit(tree, parents, `seed ${path}`));
  }

  private async route(req: IncomingMessage): Promise<[number, unknown]> {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    const body = await new Promise<Record<string, unknown>>((resolve) => {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
    });
    const m = (re: RegExp) => re.exec(path);
    let hit: RegExpExecArray | null;

    if (req.method === 'GET' && path === '') {
      return [
        200,
        { private: this.isPrivate, default_branch: 'main', permissions: { push: true } },
      ];
    }
    hit = req.method === 'GET' ? m(/^\/git\/ref\/heads\/(.+)$/) : null;
    if (hit) {
      const sha = this.refs.get(hit[1] ?? '');
      if (sha) return [200, { object: { sha } }];
      return this.refs.size === 0 ? [409, { message: 'Git Repository is empty.' }] : [404, {}];
    }
    hit = req.method === 'GET' ? m(/^\/git\/commits\/(\w+)$/) : null;
    if (hit) {
      const c = this.commits.get(hit[1] ?? '');
      return c ? [200, { sha: hit[1], tree: { sha: c.tree } }] : [404, {}];
    }
    hit = req.method === 'GET' ? m(/^\/git\/trees\/(\w+)$/) : null;
    if (hit) {
      const t = this.trees.get(hit[1] ?? '');
      if (!t) return [404, {}];
      return [
        200,
        { truncated: false, tree: [...t].map(([p, sha]) => ({ path: p, type: 'blob', sha })) },
      ];
    }
    hit = req.method === 'GET' ? m(/^\/git\/blobs\/(\w+)$/) : null;
    if (hit) {
      const b = this.blobs.get(hit[1] ?? '');
      return b ? [200, { content: b.toString('base64'), encoding: 'base64' }] : [404, {}];
    }
    if (req.method === 'POST' && path === '/git/blobs') {
      return [201, { sha: this.putBlob(Buffer.from(String(body.content), 'base64')) }];
    }
    if (req.method === 'POST' && path === '/git/trees') {
      const next = new Map(this.trees.get(String(body.base_tree)) ?? []);
      for (const e of body.tree as { path: string; sha: string | null }[]) {
        if (e.sha === null) next.delete(e.path);
        else next.set(e.path, e.sha);
      }
      return [201, { sha: this.putTree(next) }];
    }
    if (req.method === 'POST' && path === '/git/commits') {
      return [
        201,
        { sha: this.putCommit(String(body.tree), body.parents as string[], String(body.message)) },
      ];
    }
    hit = req.method === 'PATCH' ? m(/^\/git\/refs\/heads\/(.+)$/) : null;
    if (hit) {
      this.refs.set(hit[1] ?? '', String(body.sha));
      return [200, {}];
    }
    if (req.method === 'POST' && path === '/git/refs') {
      this.refs.set(String(body.ref).replace('refs/heads/', ''), String(body.sha));
      return [201, {}];
    }
    hit = req.method === 'PUT' ? m(/^\/contents\/(.+)$/) : null;
    if (hit) {
      this.seed(
        String(body.branch),
        hit[1] ?? '',
        Buffer.from(String(body.content), 'base64').toString('utf8'),
      );
      return [201, {}];
    }
    return [404, { message: `fake: ${req.method} ${path}` }];
  }

  private putBlob(body: Buffer): string {
    const sha = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
    this.blobs.set(sha, body);
    return sha;
  }

  private putTree(files: Map<string, string>): string {
    const sha = createHash('sha1')
      .update(JSON.stringify([...files].sort()))
      .digest('hex');
    this.trees.set(sha, files);
    return sha;
  }

  private putCommit(tree: string, parents: string[], message: string): string {
    const sha = createHash('sha1')
      .update(`${tree}${parents.join()}${message}${this.commits.size}`)
      .digest('hex');
    this.commits.set(sha, { tree, parents, message });
    return sha;
  }
}
