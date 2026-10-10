import { ArchiveFile, BaseGateway, ExternalFailure } from '../../../apps/server/src/plugin-api';

/** GitHub가 돌려준 JSON을 안전하게 읽는다. 없는 값은 빈 값이 된다 */
export class GithubJson {
  constructor(private readonly value: unknown) {}

  get(key: string): GithubJson {
    const v =
      this.value && typeof this.value === 'object'
        ? (this.value as Record<string, unknown>)[key]
        : undefined;
    return new GithubJson(v);
  }

  str(): string {
    return typeof this.value === 'string' ? this.value : '';
  }

  bool(): boolean {
    return this.value === true;
  }

  list(): GithubJson[] {
    return Array.isArray(this.value) ? this.value.map((v) => new GithubJson(v)) : [];
  }
}

/** 저장소 정보 */
export class GithubRepo {
  constructor(
    readonly isPrivate: boolean,
    readonly defaultBranch: string,
    readonly canPush: boolean,
  ) {}
}

/** 브랜치 맨 끝의 모습: 커밋과 그 안의 파일(경로 → git blob sha) */
export class RemoteSnapshot {
  constructor(
    readonly headSha: string | null,
    readonly treeSha: string | null,
    readonly files: ReadonlyMap<string, string>,
  ) {}

  /** 보관 형식이 관리하는 파일인가 (README 같은 다른 파일은 건드리지 않는다) */
  static isManaged(path: string): boolean {
    return path === 'cairn.json' || /^(blog|vault|assets)\//.test(path);
  }

  hasPrivateArea(): boolean {
    return [...this.files.keys()].some((p) => p.startsWith('vault/'));
  }
}

/** 한 번의 커밋 결과 */
export class CommitResult {
  private constructor(
    readonly sha: string | null,
    readonly changed: number,
    readonly removed: number,
  ) {}

  static committed(sha: string, changed: number, removed: number): CommitResult {
    return new CommitResult(sha, changed, removed);
  }

  static unchanged(sha: string | null): CommitResult {
    return new CommitResult(sha, 0, 0);
  }

  get didCommit(): boolean {
    return this.changed + this.removed > 0;
  }
}

// GitHub API를 부르는 곳은 여기 하나. 여러 파일을 커밋 하나로 묶기 위해 Git Data API(blob → tree → commit → ref)를 쓴다.
export class GithubGateway extends BaseGateway {
  protected readonly name = 'GitHub';
  protected override readonly timeoutMs = 20_000;
  protected override readonly retries = 1;

  constructor(
    private readonly repo: string,
    private readonly token: string,
    private readonly apiUrl = 'https://api.github.com',
  ) {
    super();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
      throw new Error(`저장소는 owner/name 형식이어야 해요: ${repo}`);
  }

  async repoInfo(): Promise<GithubRepo> {
    const r = await this.request('GET', '');
    return new GithubRepo(
      r.get('private').bool(),
      r.get('default_branch').str() || 'main',
      r.get('permissions').get('push').bool(),
    );
  }

  async snapshot(branch: string): Promise<RemoteSnapshot> {
    const ref = await this.requestOptional('GET', `/git/ref/heads/${branch}`);
    if (!ref) return new RemoteSnapshot(null, null, new Map());
    const headSha = ref.get('object').get('sha').str();
    const commit = await this.request('GET', `/git/commits/${headSha}`);
    const treeSha = commit.get('tree').get('sha').str();
    const tree = await this.request('GET', `/git/trees/${treeSha}?recursive=1`);
    if (tree.get('truncated').bool()) {
      throw new ExternalFailure('저장소 파일이 너무 많아 한 번에 읽을 수 없어요');
    }
    const files = new Map<string, string>();
    for (const e of tree.get('tree').list()) {
      if (e.get('type').str() === 'blob') files.set(e.get('path').str(), e.get('sha').str());
    }
    return new RemoteSnapshot(headSha, treeSha, files);
  }

  /**
   * 바뀐 파일만 올리고, 보관 형식이 관리하는 파일 중 이제 없는 것은 지워서 커밋 하나로 만든다.
   * 아무것도 바뀌지 않았으면 커밋하지 않는다.
   */
  async commit(
    branch: string,
    base: RemoteSnapshot,
    files: readonly ArchiveFile[],
    message: string,
  ): Promise<CommitResult> {
    const snap = base.headSha ? base : await this.startBranch(branch, files);
    const wanted = new Set(files.map((f) => f.path));
    const changed = files.filter((f) => snap.files.get(f.path) !== f.gitSha());
    const removed = [...snap.files.keys()].filter(
      (p) => RemoteSnapshot.isManaged(p) && !wanted.has(p),
    );
    if (changed.length === 0 && removed.length === 0) return CommitResult.unchanged(snap.headSha);

    const entries: object[] = [];
    for (const f of changed) {
      const blob = await this.request('POST', '/git/blobs', {
        content: f.body.toString('base64'),
        encoding: 'base64',
      });
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.get('sha').str() });
    }
    for (const path of removed) entries.push({ path, mode: '100644', type: 'blob', sha: null });
    const tree = await this.request('POST', '/git/trees', {
      base_tree: snap.treeSha,
      tree: entries,
    });
    const commit = await this.request('POST', '/git/commits', {
      message,
      tree: tree.get('sha').str(),
      parents: [snap.headSha],
    });
    const sha = commit.get('sha').str();
    await this.request('PATCH', `/git/refs/heads/${branch}`, { sha, force: false });
    return CommitResult.committed(sha, changed.length, removed.length);
  }

  /** 브랜치의 보관 형식 파일을 모두 받아 온다 (복원용) */
  async download(branch: string): Promise<readonly ArchiveFile[]> {
    const snap = await this.snapshot(branch);
    const out: ArchiveFile[] = [];
    for (const [path, sha] of snap.files) {
      if (!RemoteSnapshot.isManaged(path)) continue;
      const blob = await this.request('GET', `/git/blobs/${sha}`);
      out.push(ArchiveFile.bytes(path, Buffer.from(blob.get('content').str(), 'base64')));
    }
    return out;
  }

  /** 브랜치가 없을 때: 기본 브랜치에서 갈라 만들고, 저장소가 비어 있으면 첫 커밋부터 만든다 */
  private async startBranch(
    branch: string,
    files: readonly ArchiveFile[],
  ): Promise<RemoteSnapshot> {
    const repo = await this.repoInfo();
    const from = await this.snapshot(repo.defaultBranch);
    if (from.headSha) {
      await this.request('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: from.headSha });
    } else {
      const first =
        files.find((f) => f.path === 'cairn.json') ?? ArchiveFile.text('cairn.json', '{}\n');
      await this.request('PUT', `/contents/${first.path}`, {
        message: 'cairn: 보관 저장소 시작',
        content: first.body.toString('base64'),
        branch,
      });
    }
    return this.snapshot(branch);
  }

  /** 실패하면 ExternalFailure */
  private async request(method: string, path: string, body?: object): Promise<GithubJson> {
    const json = await this.send(method, path, body, false);
    return json ?? new GithubJson(null);
  }

  /** 없음(404)이나 빈 저장소(409)면 null */
  private async requestOptional(method: string, path: string): Promise<GithubJson | null> {
    return this.send(method, path, undefined, true);
  }

  private send(method: string, path: string, body: object | undefined, allowMissing: boolean) {
    return this.call(async (signal): Promise<GithubJson | null> => {
      const res = await fetch(`${this.apiUrl}/repos/${this.repo}${path}`, {
        method,
        signal,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (allowMissing && (res.status === 404 || res.status === 409)) return null;
      if (!res.ok) {
        throw new Error(
          `${method} ${path || '/'} → ${res.status} ${(await res.text()).slice(0, 200)}`,
        );
      }
      return new GithubJson(await res.json());
    });
  }
}
