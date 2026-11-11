import { RuleViolation } from '../../platform';

// 코드 작업이 고치는 자리: 저장소 하나 + 고칠 수 있는 경로들 (payload.code, docs/코드작업.md 5장).
// 경로는 저장소 안의 상대 경로 접두어다 (폴더 아래 전부, 또는 파일 하나). `.`은 저장소 전체.
// 겹침은 접두어로 본다: `a/b`는 `a/b/…`와 겹치고 `a/bc`와는 겹치지 않는다.
// 같은 저장소에서 겹치는 일은 동시에 돌지 않게 하고(빌리기), 위임은 위 작업의 경로 안에서 겹치지 않게 나눈다.
// 경로의 자세한 검사(.github/workflows 등)는 러너의 CodeSpec이 한 번 더 한다.
export class CodeScope {
  /** 저장소 전체 */
  static readonly WHOLE = '.';
  /** 러너의 CodeSpec과 같은 한도 */
  static readonly PATHS_MAX = 20;
  static readonly PATH_MAX = 200;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자와 역슬래시를 막는 것이 목적이다
  private static readonly CONTROL = /[\u0000-\u001f\u007f\\]/;

  private constructor(
    /** payload.code 그대로 (저장소 · setup · checks). 하위 작업이 물려받는다 */
    private readonly code: Readonly<Record<string, unknown>>,
    /** 같은 저장소인지 비교하는 값: 소문자, 끝의 `/`와 `.git`을 뺀 주소 */
    readonly repo: string,
    readonly paths: readonly string[],
  ) {}

  /** 작업 payload의 code에서. 저장소 주소나 경로가 없으면 null (code 작업이 아니거나 모양이 틀림) */
  static of(payload: unknown): CodeScope | null {
    const code = (payload as { code?: unknown } | null)?.code;
    if (typeof code !== 'object' || code === null) return null;
    const { repo, paths } = code as { repo?: { url?: unknown }; paths?: unknown };
    if (typeof repo?.url !== 'string' || !Array.isArray(paths)) return null;
    const clean = paths.filter((p): p is string => typeof p === 'string').map(CodeScope.normal);
    if (clean.length === 0) return null;
    return new CodeScope(code as Record<string, unknown>, CodeScope.repoKey(repo.url), clean);
  }

  /**
   * 위 작업의 저장소 · 명령을 물려받고 경로만 좁힌다 (위임). 경로의 모양이 틀리거나 위 작업의 경로 밖이면 RuleViolation
   */
  narrowTo(paths: readonly string[] | null): CodeScope {
    if (paths === null || paths.length === 0)
      throw new RuleViolation('코드 일을 맡길 때는 고칠 수 있는 곳(paths)을 적어 주세요');
    if (paths.length > CodeScope.PATHS_MAX)
      throw new RuleViolation(`고칠 수 있는 곳은 ${CodeScope.PATHS_MAX}개까지예요`);
    const clean = [...new Set(paths.map(CodeScope.normal))];
    const wrong = clean.filter(
      (p) =>
        p.length > CodeScope.PATH_MAX ||
        p.startsWith('/') ||
        p.split('/').includes('..') ||
        CodeScope.CONTROL.test(p),
    );
    if (wrong.length > 0)
      throw new RuleViolation(
        `저장소 안의 상대 경로만 (.. · / 로 시작은 안 돼요): ${wrong.join(', ')}`,
      );
    const outside = clean.filter((p) => !this.paths.some((mine) => CodeScope.contains(mine, p)));
    if (outside.length > 0)
      throw new RuleViolation(`이 작업의 고칠 수 있는 곳 밖이에요: ${outside.join(', ')}`);
    return new CodeScope(this.code, this.repo, clean);
  }

  /** 같은 저장소에서 경로가 겹치는가 */
  overlaps(other: CodeScope): boolean {
    return (
      this.repo === other.repo &&
      this.paths.some((a) =>
        other.paths.some((b) => CodeScope.contains(a, b) || CodeScope.contains(b, a)),
      )
    );
  }

  /** 하위 작업의 payload.code: 위 작업의 저장소 · 명령에 좁힌 경로 */
  toPayload(): Record<string, unknown> {
    return { ...this.code, paths: this.paths };
  }

  /** 서로 겹치는 것이 있으면 RuleViolation (위임할 때 형제끼리: 겹치면 PR이 부딪친다) */
  static assertApart(scopes: readonly CodeScope[]): void {
    for (let i = 0; i < scopes.length; i++)
      for (let j = i + 1; j < scopes.length; j++) {
        const [a, b] = [scopes[i] as CodeScope, scopes[j] as CodeScope];
        if (a.overlaps(b))
          throw new RuleViolation(
            `하위 작업끼리 고칠 곳이 겹쳐요: ${a.paths.join(', ')} / ${b.paths.join(', ')}`,
          );
      }
  }

  /** outer가 inner를 품는가 (같거나 접두어 폴더) */
  private static contains(outer: string, inner: string): boolean {
    return outer === CodeScope.WHOLE || outer === inner || inner.startsWith(`${outer}/`);
  }

  /** 앞뒤 공백, 앞의 `./`, 끝의 `/`를 뺀다. 비면 저장소 전체 */
  private static normal(this: void, path: string): string {
    const p = path
      .trim()
      .replace(/^(\.\/)+/, '')
      .replace(/\/+$/, '');
    return p === '' ? CodeScope.WHOLE : p;
  }

  private static repoKey(url: string): string {
    return url
      .trim()
      .toLowerCase()
      .replace(/\/+$/, '')
      .replace(/\.git$/, '');
  }
}
