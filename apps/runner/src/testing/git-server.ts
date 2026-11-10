import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 시험용 git 서버: 이 컴퓨터(127.0.0.1)에서 git http-backend로 bare 저장소를 http로 내준다 (clone · push).
// 코드 작업의 러너가 GitHub 대신 여기에 붙는다. 저장소의 기준 브랜치는 main이고 처음 파일들을 넣어 둔다.
export class GitServer {
  private constructor(
    private readonly server: Server,
    private readonly root: string,
    readonly baseUrl: string,
  ) {}

  static async start(): Promise<GitServer> {
    const root = mkdtempSync(join(tmpdir(), 'cairn-git-'));
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const child = spawn('git', ['http-backend'], {
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: root,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_PROJECT_ROOT: root,
          GIT_HTTP_EXPORT_ALL: '1',
          PATH_INFO: decodeURIComponent(url.pathname),
          QUERY_STRING: url.search.slice(1),
          REQUEST_METHOD: req.method ?? 'GET',
          CONTENT_TYPE: req.headers['content-type'] ?? '',
          ...(req.headers['content-length']
            ? { CONTENT_LENGTH: req.headers['content-length'] }
            : {}),
          ...(req.headers['content-encoding']
            ? { HTTP_CONTENT_ENCODING: req.headers['content-encoding'] }
            : {}),
          ...(req.headers['git-protocol']
            ? { GIT_PROTOCOL: String(req.headers['git-protocol']) }
            : {}),
          REMOTE_USER: 'cairn-test', // receive-pack(push)을 허락한다
          REMOTE_ADDR: '127.0.0.1',
        },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      req.pipe(child.stdin);
      let head = Buffer.alloc(0);
      let started = false;
      child.stdout.on('data', (chunk: Buffer) => {
        if (started) return void res.write(chunk);
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf('\r\n\r\n');
        if (end < 0) return;
        let status = 200;
        for (const line of head.subarray(0, end).toString('utf8').split('\r\n')) {
          const at = line.indexOf(':');
          const name = line.slice(0, at).trim();
          const value = line.slice(at + 1).trim();
          if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0]);
          else if (name) res.setHeader(name, value);
        }
        res.writeHead(status);
        started = true;
        res.write(head.subarray(end + 4));
      });
      child.stdout.on('end', () => res.end());
      child.on('error', () => res.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return new GitServer(server, root, `http://127.0.0.1:${port}`);
  }

  /** bare 저장소 하나를 만들고 main에 처음 파일들을 커밋한다. 주소를 준다 */
  create(name: string, files: Readonly<Record<string, string>>): string {
    const bare = join(this.root, `${name}.git`);
    const work = mkdtempSync(join(this.root, 'seed-'));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, {
        cwd,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .toString()
        .trim();
    git(this.root, 'init', '-q', '--bare', '-b', 'main', bare);
    git(work, 'init', '-q', '-b', 'main');
    for (const [path, content] of Object.entries(files)) {
      const file = join(work, path);
      execFileSync('mkdir', ['-p', join(file, '..')]);
      writeFileSync(file, content);
    }
    git(work, 'add', '-A');
    git(
      work,
      '-c',
      'user.name=seed',
      '-c',
      'user.email=seed@localhost',
      'commit',
      '-q',
      '-m',
      '처음',
    );
    git(work, 'push', '-q', bare, 'main');
    rmSync(work, { recursive: true, force: true });
    return `${this.baseUrl}/${name}.git`;
  }

  /** 브랜치의 커밋. 없으면 null */
  head(name: string, branch: string): string | null {
    try {
      return execFileSync('git', [
        '--git-dir',
        join(this.root, `${name}.git`),
        'rev-parse',
        '--verify',
        '-q',
        `refs/heads/${branch}`,
      ])
        .toString()
        .trim();
    } catch {
      return null;
    }
  }

  /** 브랜치의 파일 내용. 없으면 null */
  show(name: string, branch: string, path: string): string | null {
    try {
      return execFileSync(
        'git',
        ['--git-dir', join(this.root, `${name}.git`), 'show', `refs/heads/${branch}:${path}`],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).toString();
    } catch {
      return null;
    }
  }

  /** 브랜치에서 기준(main)과 달라진 파일들 */
  changed(name: string, branch: string): readonly string[] {
    return execFileSync('git', [
      '--git-dir',
      join(this.root, `${name}.git`),
      'diff',
      '--name-only',
      'main',
      `refs/heads/${branch}`,
    ])
      .toString()
      .split('\n')
      .filter(Boolean);
  }

  close(): void {
    this.server.close();
    this.server.closeAllConnections();
    rmSync(this.root, { recursive: true, force: true });
  }
}
