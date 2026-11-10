import { execFile } from 'node:child_process';
import type { CodeSpec } from './code-spec';

/** 저장소에 닿지 못함 (네트워크 · 서버 오류 · 시간 초과). 일을 돌려주고 기다린다 */
export class RepoUnreachable extends Error {}

/** 저장소 · 브랜치가 없거나 저장소가 거절함 (인증, 허용 목록 밖). 다시 해도 같다 */
export class RepoRefused extends Error {}

/** AI가 만든 patch를 깨끗한 clone에 옮기지 못함 (저장소 밖 경로, 링크 너머, .git 등) */
export class PatchRejected extends Error {}

// 러너(믿는 쪽)의 git (docs/코드작업.md 3단계). 러너가 만든 깨끗한 clone에서만 돌고, AI의 자리에서는 돌지 않는다:
// AI가 심어 둔 .git/hooks · core.fsmonitor 같은 것이 root로, 토큰이 있는 환경에서 돌지 않게.
// 설정 파일은 읽지 않는다 (시스템 · 사용자 설정을 끄고 필요한 설정은 환경의 GIT_CONFIG_*로만).
// 저장소 토큰(4단계)도 환경으로만 넘긴다: 인자(ps에 보임) · .git/config · 원격 주소에 쓰지 않는다.
// 전송은 http(s)만 허락한다 (ext:: · file:: 같은 다른 길을 막는다).
export class GitRepo {
  private static readonly CLONE_MS = 5 * 60_000;
  private static readonly PUSH_MS = 5 * 60_000;
  private static readonly LOCAL_MS = 2 * 60_000;
  private static readonly OUTPUT_MAX = 64 * 1024 * 1024;
  /** 러너가 올리는 브랜치는 이 아래만. 다른 브랜치는 덮어쓰지 않는다 */
  private static readonly OWN_BRANCH = /^cairn\/[0-9a-f-]{36}$/;
  /** 다시 해도 같은 실패 (영어로 받는다: LANG=C) */
  private static readonly REFUSED =
    /Repository not found|not found|Authentication failed|could not read Username|returned error: (401|403|404)|from proxy after CONNECT|couldn't find remote ref|Remote branch .* not found|not allowed/i;
  /** 잠깐의 실패 */
  private static readonly UNREACHABLE =
    /Could not resolve|Failed to connect|Connection (refused|reset|timed out)|timed out|returned error: 5\d\d|RPC failed|early EOF|unexpected disconnect|SSL_ERROR|Empty reply/i;
  /** 이 환경에서 넘기는 것. 나머지(기기 토큰 등)는 git에게 가지 않는다 */
  private static readonly PASSED_ENV = [
    'PATH',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'https_proxy',
    'http_proxy',
    'no_proxy',
  ];
  private static readonly CONFIG: readonly (readonly [string, string])[] = [
    ['core.hooksPath', '/dev/null'],
    ['core.fsmonitor', 'false'],
    ['protocol.allow', 'never'],
    ['protocol.https.allow', 'always'],
    ['protocol.http.allow', 'always'],
    ['credential.helper', ''],
    ['core.quotePath', 'false'],
    ['advice.detachedHead', 'false'],
    ['init.defaultBranch', 'main'],
  ];

  private constructor(
    readonly dir: string,
    /** clone한 기준 커밋. AI의 변경은 이것과 견준다 */
    readonly baseSha: string,
    /** 러너만 보는 git의 홈 (비어 있다) */
    private readonly home: string,
  ) {}

  /**
   * 브랜치를 얕게 받는다: 보통은 기준 브랜치, "고쳐 달라"로 다시 온 일이면 이미 올린 cairn/<작업>(from).
   * auth는 저장소 토큰 (없으면 공개 저장소 · 시험용 서버).
   * 실패는 RepoUnreachable(돌려주고 기다림)이나 RepoRefused(실패로 끝냄)
   */
  static async clone(
    spec: CodeSpec,
    dir: string,
    home: string,
    auth: string | null,
    signal?: AbortSignal,
    from: string = spec.base,
  ): Promise<GitRepo> {
    await GitRepo.git(
      [
        'clone',
        '--depth',
        '1',
        '--single-branch',
        '--no-tags',
        '--branch',
        from,
        '--',
        spec.repoUrl,
        dir,
      ],
      { home, auth, timeoutMs: GitRepo.CLONE_MS, signal, remote: true },
    );
    const sha = await GitRepo.git(['-C', dir, 'rev-parse', 'HEAD'], {
      home,
      timeoutMs: GitRepo.LOCAL_MS,
    });
    return new GitRepo(dir, sha.trim(), home);
  }

  /**
   * AI의 자리에서 agent 권한으로 만든 patch를 깨끗한 clone에 옮기고 바뀐 파일들을 준다.
   * git apply가 저장소 밖 · .git 안 · 링크 너머로 가는 경로를 거절한다. 빈 patch면 빈 목록
   */
  async apply(patchFile: string, empty: boolean): Promise<readonly string[]> {
    if (empty) return [];
    try {
      await this.run(['apply', '--index', '--whitespace=nowarn', '--', patchFile]);
    } catch (error) {
      throw new PatchRejected((error as Error).message);
    }
    const names = await this.run(['diff', '--cached', '--name-only', '--no-renames', '-z', 'HEAD']);
    return names.split('\0').filter(Boolean);
  }

  /** 바뀐 것을 커밋 하나로 묶고 그 커밋을 준다 */
  async commit(message: string, author: string): Promise<string> {
    await this.run(
      ['-c', `user.name=${author}`, '-c', 'user.email=cairn@localhost', 'commit', '-q', '-F', '-'],
      message,
    );
    return (await this.run(['rev-parse', 'HEAD'])).trim();
  }

  /** 러너의 브랜치(cairn/<작업>)에만 올린다. 다시 한 작업은 같은 브랜치에 덮어쓴다 */
  async push(branch: string, auth: string | null, signal?: AbortSignal): Promise<void> {
    if (!GitRepo.OWN_BRANCH.test(branch))
      throw new RepoRefused(`러너는 cairn/ 아래 브랜치에만 올려요: ${branch}`);
    await GitRepo.git(
      ['-C', this.dir, 'push', '--force', '--no-verify', 'origin', `HEAD:refs/heads/${branch}`],
      { home: this.home, auth, timeoutMs: GitRepo.PUSH_MS, signal, remote: true },
    );
  }

  private run(args: readonly string[], input?: string): Promise<string> {
    return GitRepo.git(['-C', this.dir, ...args], {
      home: this.home,
      timeoutMs: GitRepo.LOCAL_MS,
      input,
    });
  }

  private static git(
    args: readonly string[],
    options: {
      home: string;
      timeoutMs: number;
      auth?: string | null;
      signal?: AbortSignal;
      input?: string;
      /** 원격과 이야기하는가 (실패를 닿지 못함 · 거절로 나눈다) */
      remote?: boolean;
    },
  ): Promise<string> {
    const { home, timeoutMs, auth = null, signal, input, remote = false } = options;
    return new Promise((resolve, reject) => {
      const child = execFile(
        'git',
        args,
        {
          env: GitRepo.env(home, auth),
          timeout: timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: GitRepo.OUTPUT_MAX,
          signal,
        },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout);
          const why = (stderr || error.message).trim().split('\n').slice(-3).join(' ');
          const timedOut = (error as { killed?: boolean }).killed === true;
          if (!remote) return reject(new Error(`git: ${why}`));
          if (timedOut || signal?.aborted)
            return reject(new RepoUnreachable(`시간이 지났어요: ${why}`));
          if (GitRepo.REFUSED.test(why)) return reject(new RepoRefused(why));
          if (GitRepo.UNREACHABLE.test(why)) return reject(new RepoUnreachable(why));
          reject(new RepoRefused(why));
        },
      );
      if (input !== undefined) child.stdin?.end(input);
    });
  }

  /** git의 환경: 설정 파일 없이, 묻지 않고, 영어로. 설정은 GIT_CONFIG_*로만 (인자와 파일에 남지 않는다) */
  private static env(home: string, auth: string | null): Record<string, string> {
    const passed = GitRepo.PASSED_ENV.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value] as const];
    });
    const config =
      auth === null
        ? GitRepo.CONFIG
        : [
            ...GitRepo.CONFIG,
            [
              'http.extraHeader',
              `Authorization: Basic ${Buffer.from(`x-access-token:${auth}`).toString('base64')}`,
            ] as const,
          ];
    return {
      ...Object.fromEntries(passed),
      HOME: home,
      LANG: 'C',
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'false',
      GIT_CONFIG_COUNT: String(config.length),
      ...Object.fromEntries(
        config.flatMap(([key, value], i) => [
          [`GIT_CONFIG_KEY_${i}`, key],
          [`GIT_CONFIG_VALUE_${i}`, value],
        ]),
      ),
    };
  }
}
