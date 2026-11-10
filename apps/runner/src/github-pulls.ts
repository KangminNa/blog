import { pause } from './backoff';

/** GitHub가 거절함 (권한 · 저장소 없음 · 틀린 요청). 다시 해도 같다 */
export class PullRefused extends Error {}

// 러너가 여는 PR (코드 작업 4단계). push한 cairn/<작업> 브랜치로 draft PR을 열고, 이미 있으면 본문만 고친다.
// 토큰은 code_credential로 받은 것이고 러너의 메모리에만 있다 (AI에게 가지 않는다). 칸 안에서는 나가는 프록시를 거친다
// (fetch가 HTTPS_PROXY를 쓰도록 칸에 NODE_USE_ENV_PROXY=1). 외부 라이브러리 없이 REST 두세 번이다.
export class GitHubPulls {
  private static readonly TRIES = 3;
  private static readonly CALL_MS = 30_000;
  /** https://<호스트>/<owner>/<이름>[.git] */
  private static readonly REPO = /^https?:\/\/[^/@\s]+\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/;
  private static readonly BODY_MAX = 60_000;

  private constructor(
    private readonly apiUrl: string,
    private readonly token: string,
    private readonly owner: string,
    private readonly name: string,
  ) {}

  /** 저장소 주소에서 owner · 이름을 읽는다. 모양이 틀리면 PullRefused */
  static of(apiUrl: string, token: string, repoUrl: string): GitHubPulls {
    const found = GitHubPulls.REPO.exec(repoUrl);
    if (!found) throw new PullRefused(`GitHub 저장소 주소가 아니에요: ${repoUrl}`);
    return new GitHubPulls(
      apiUrl.replace(/\/+$/, ''),
      token,
      found[1] as string,
      found[2] as string,
    );
  }

  /**
   * branch → base의 PR을 연다. 같은 브랜치로 열린 PR이 있으면 그 본문을 고친다 (다시 한 일 · 응답을 잃은 재시도에도 PR은 하나).
   * 번호와 주소를 준다
   */
  async ensure(
    branch: string,
    base: string,
    title: string,
    body: string,
    signal?: AbortSignal,
  ): Promise<{ number: number; url: string }> {
    const text = body.slice(0, GitHubPulls.BODY_MAX);
    const open = await this.call(
      'GET',
      `/pulls?state=open&head=${encodeURIComponent(`${this.owner}:${branch}`)}`,
      null,
      signal,
    );
    const found = Array.isArray(open) ? (open[0] as PullJson | undefined) : undefined;
    if (found) {
      await this.call('PATCH', `/pulls/${found.number}`, { body: text }, signal);
      return { number: found.number, url: found.html_url };
    }
    const made = (await this.call(
      'POST',
      '/pulls',
      { title, head: branch, base, body: text, draft: true },
      signal,
    )) as PullJson;
    return { number: made.number, url: made.html_url };
  }

  private async call(
    method: string,
    path: string,
    payload: object | null,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let wait = 1_000;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.apiUrl}/repos/${this.owner}/${this.name}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'cairn-runner',
            ...(payload ? { 'content-type': 'application/json' } : {}),
          },
          body: payload ? JSON.stringify(payload) : undefined,
          signal: AbortSignal.any([
            AbortSignal.timeout(GitHubPulls.CALL_MS),
            ...(signal ? [signal] : []),
          ]),
        });
      } catch (error) {
        if (attempt >= GitHubPulls.TRIES || signal?.aborted) throw error;
        await pause(wait, signal);
        wait *= 2;
        continue;
      }
      if (res.ok) return res.json();
      const message = await GitHubPulls.messageOf(res);
      if (res.status >= 500 && attempt < GitHubPulls.TRIES) {
        await pause(wait, signal);
        wait *= 2;
        continue;
      }
      throw new PullRefused(`GitHub ${method} ${path.split('?')[0]}: ${res.status} ${message}`);
    }
  }

  private static async messageOf(res: Response): Promise<string> {
    const text = await res.text().catch(() => '');
    try {
      const body = JSON.parse(text) as { message?: unknown };
      if (typeof body.message === 'string') return body.message;
    } catch {
      // JSON이 아닌 답
    }
    return text.slice(0, 200);
  }
}

/** GitHub의 PR 응답 중 쓰는 칸 */
type PullJson = { number: number; html_url: string };
