/** payload.code가 틀림. AI를 띄우지 않고 실패로 끝낸다 */
export class CodeSpecProblem extends Error {}

// 코드 작업 하나의 저장소 정보 (작업의 payload.code, docs/코드작업.md 5장):
//   { repo: { url, base }, paths: [...], setup: "…" | null, checks: ["…"] }
// 4단계부터는 기능 패키지 code-github가 주인이 등록한 저장소로 만든다. 서버가 보낸 값이라도 경로 · 명령 · 주소로 쓰기 전에 모양을 본다.
// paths는 저장소 안의 상대 경로 접두어다 (폴더 아래 전부, 또는 파일 하나). "."은 저장소 전체.
// .github/workflows는 paths와 상관없이 늘 막는다: 브랜치에 push하면 그 워크플로가 저장소 비밀값과 함께 돌 수 있다.
export class CodeSpec {
  /** 저장소 전체 */
  static readonly WHOLE = '.';
  static readonly ALWAYS_BLOCKED: readonly string[] = ['.github/workflows'];
  private static readonly URL_MAX = 500;
  private static readonly BASE_MAX = 100;
  private static readonly PATHS_MAX = 20;
  private static readonly PATH_MAX = 200;
  private static readonly SETUP_MAX = 2_000;
  private static readonly CHECKS_MAX = 10;
  private static readonly CHECK_MAX = 500;
  /** 브랜치 이름에 쓸 수 있는 글자. 그 밖의 git 규칙(.., @{, .lock 등)은 따로 본다 */
  private static readonly BASE = /^[A-Za-z0-9._/-]+$/;
  /** 시험용으로 http를 허락하는 이 컴퓨터의 이름 */
  private static readonly LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
  private static readonly TASK_ID = /^[0-9a-f-]{36}$/;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 막는 것이 목적이다
  private static readonly CONTROL = /[\u0000-\u001f\u007f]/;

  private constructor(
    readonly taskId: string,
    /** 자격이 없는 주소 (토큰은 4단계에서 환경으로만 넘긴다) */
    readonly repoUrl: string,
    /** 기준 브랜치 */
    readonly base: string,
    readonly paths: readonly string[],
    /** 저장소를 받은 뒤 AI 전에 돌리는 명령 (agent로) */
    readonly setup: string | null,
    /** AI가 끝난 뒤 돌리는 검사 명령들 (agent로). 실패해도 올리고 결과에 적는다 */
    readonly checks: readonly string[],
  ) {}

  static from(taskId: string, raw: unknown): CodeSpec {
    if (!CodeSpec.TASK_ID.test(taskId)) throw new CodeSpecProblem(`작업 id가 틀려요: ${taskId}`);
    const code = CodeSpec.object(raw, 'payload.code');
    const repo = CodeSpec.object(code.repo, 'repo');
    return new CodeSpec(
      taskId,
      CodeSpec.url(repo.url),
      CodeSpec.baseOf(repo.base),
      CodeSpec.pathsOf(code.paths),
      CodeSpec.command(
        code.setup === '' ? null : (code.setup ?? null),
        'setup',
        CodeSpec.SETUP_MAX,
      ),
      CodeSpec.checksOf(code.checks ?? []),
    );
  }

  /** 이 작업이 올리는 브랜치. 러너만 쓰고, 다시 하면 같은 이름에 덮어쓴다 */
  get branch(): string {
    return `cairn/${this.taskId}`;
  }

  /** 이 파일을 고쳐도 되는가 (git이 주는 저장소 안의 경로) */
  allows(file: string): boolean {
    const lower = file.toLowerCase();
    if (CodeSpec.ALWAYS_BLOCKED.some((b) => lower === b || lower.startsWith(`${b}/`))) return false;
    return this.paths.some((p) => p === CodeSpec.WHOLE || file === p || file.startsWith(`${p}/`));
  }

  /** 고치면 안 되는 곳을 고친 파일들 */
  outside(files: readonly string[]): readonly string[] {
    return files.filter((file) => !this.allows(file));
  }

  /** AI에게 주는 단락. 주소에는 자격이 없다 */
  get brief(): string {
    const where = this.paths.includes(CodeSpec.WHOLE)
      ? ['- 저장소 전체']
      : this.paths.map((p) => `- ${p}`);
    const lines = [
      '# 저장소',
      `${this.repoUrl} (기준 브랜치 ${this.base}). 작업 폴더가 이 저장소의 사본이고 셸을 쓸 수 있습니다.`,
      '',
      '# 고칠 수 있는 곳',
      ...where,
      `이 밖이나 ${CodeSpec.ALWAYS_BLOCKED.join(', ')}를 고치면 아무것도 올라가지 않습니다.`,
    ];
    if (this.checks.length > 0)
      lines.push(
        '',
        '# 검사 명령',
        ...this.checks.map((c) => `- ${c}`),
        '끝내기 전에 돌려 봅니다. 끝나면 러너가 한 번 더 돌려 결과에 적습니다.',
      );
    lines.push(
      '',
      '커밋 · push · 원격 설정은 하지 않습니다. 끝나면 러너가 바뀐 것을 하나로 묶어 올립니다.',
    );
    return lines.join('\n');
  }

  private static object(raw: unknown, name: string): Readonly<Record<string, unknown>> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      throw new CodeSpecProblem(`${name}가 없어요`);
    return raw as Record<string, unknown>;
  }

  /** https만. 시험용으로 이 컴퓨터(127.0.0.1 · localhost)만 http도. 자격 · 조각은 받지 않는다 */
  private static url(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > CodeSpec.URL_MAX)
      throw new CodeSpecProblem('저장소 주소가 없어요');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new CodeSpecProblem(`저장소 주소가 틀려요: ${raw}`);
    }
    const local = CodeSpec.LOCAL_HOSTS.includes(url.hostname);
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)))
      throw new CodeSpecProblem(`저장소 주소는 https만 돼요: ${url.protocol}`);
    if (url.username || url.password)
      throw new CodeSpecProblem('저장소 주소에 자격을 넣지 않아요 (토큰은 따로 받아요)');
    if (url.hash || url.search) throw new CodeSpecProblem('저장소 주소에 ?나 #를 넣지 않아요');
    return url.toString();
  }

  /** git의 브랜치 이름 규칙 중 위험한 것만 (옵션처럼 보이는 이름, .., @{, 빈 부분) */
  private static baseOf(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > CodeSpec.BASE_MAX)
      throw new CodeSpecProblem('기준 브랜치가 없어요');
    const parts = raw.split('/');
    const bad =
      !CodeSpec.BASE.test(raw) ||
      raw.startsWith('-') ||
      raw.includes('..') ||
      raw.endsWith('.lock') ||
      raw.endsWith('.') ||
      parts.some((p) => p === '' || p.startsWith('.'));
    if (bad) throw new CodeSpecProblem(`기준 브랜치 이름이 틀려요: ${raw}`);
    return raw;
  }

  private static pathsOf(raw: unknown): readonly string[] {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > CodeSpec.PATHS_MAX)
      throw new CodeSpecProblem(`고칠 경로(paths)는 1~${CodeSpec.PATHS_MAX}개예요`);
    return [...new Set(raw.map((p) => CodeSpec.pathOf(p)))];
  }

  /** 저장소 안의 상대 경로. 끝의 /는 뗀다. 위로 가기 · .git · 절대 경로는 안 된다 */
  private static pathOf(raw: unknown): string {
    if (typeof raw !== 'string') throw new CodeSpecProblem('경로는 글자여야 해요');
    const path = raw.trim().replace(/\/+$/, '');
    if (path === CodeSpec.WHOLE) return path;
    const parts = path.split('/');
    const bad =
      path.length === 0 ||
      path.length > CodeSpec.PATH_MAX ||
      raw.trim().startsWith('/') ||
      path.includes('\\') ||
      CodeSpec.CONTROL.test(path) ||
      parts.some((p) => p === '' || p === '.' || p === '..' || p.toLowerCase() === '.git');
    if (bad) throw new CodeSpecProblem(`고칠 경로가 틀려요: ${raw}`);
    return path;
  }

  private static checksOf(raw: unknown): readonly string[] {
    if (!Array.isArray(raw) || raw.length > CodeSpec.CHECKS_MAX)
      throw new CodeSpecProblem(`검사 명령(checks)은 ${CodeSpec.CHECKS_MAX}개까지예요`);
    return raw.map((c) => CodeSpec.command(c, 'checks', CodeSpec.CHECK_MAX) as string);
  }

  private static command(raw: unknown, name: string, max: number): string | null {
    if (raw === null) return null;
    if (
      typeof raw !== 'string' ||
      raw.trim().length === 0 ||
      raw.length > max ||
      raw.includes('\0')
    )
      throw new CodeSpecProblem(`${name} 명령은 ${max}자 이하의 글자예요`);
    return raw.trim();
  }
}
