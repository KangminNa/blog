/** 허용 목록 파일이 틀림. 프록시는 시작하지 않는다 (틀린 줄을 건너뛰고 시작하면 무엇이 열렸는지 알 수 없다) */
export class AllowListProblem extends Error {}

// 나가는 프록시의 허용 목록. 한 줄에 호스트 하나:
//   github.com             이 호스트만
//   .githubusercontent.com 하위 도메인 전부 (자기 자신은 빼고: 필요하면 따로 적는다)
//   # 주석                  # 뒤는 읽지 않는다
// 와일드카드(*), IP 주소, 포트, 경로는 받지 않는다. 하위 도메인 규칙은 점 두 개 이상(.com 같은 최상위만은 안 된다).
export class AllowList {
  private static readonly LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

  private constructor(
    private readonly exact: ReadonlySet<string>,
    /** 앞에 점이 붙은 꼬리 (".githubusercontent.com") */
    private readonly suffixes: readonly string[],
  ) {}

  static parse(text: string): AllowList {
    const exact = new Set<string>();
    const suffixes: string[] = [];
    text.split('\n').forEach((raw, index) => {
      const line = (raw.split('#')[0] ?? '').trim().toLowerCase();
      if (line === '') return;
      const where = `${index + 1}번째 줄 "${line}"`;
      if (line.startsWith('.')) {
        const labels = line.slice(1).split('.');
        if (labels.length < 2 || !labels.every((l) => AllowList.LABEL.test(l)))
          throw new AllowListProblem(`${where}: 하위 도메인 규칙은 .example.com 모양이어야 해요`);
        suffixes.push(line);
        return;
      }
      const labels = line.split('.');
      if (
        labels.length < 2 ||
        !labels.every((l) => AllowList.LABEL.test(l)) ||
        /^\d+$/.test(labels.at(-1) ?? '')
      )
        throw new AllowListProblem(`${where}: 호스트 이름만 적어요 (예: github.com)`);
      exact.add(line);
    });
    return new AllowList(exact, suffixes);
  }

  /** 이 호스트로 나가도 되는가. 대소문자와 끝의 점은 무시한다 */
  allows(host: string): boolean {
    const name = host.toLowerCase().replace(/\.$/, '');
    return this.exact.has(name) || this.suffixes.some((suffix) => name.endsWith(suffix));
  }

  /** 규칙 수 (시작할 때 알린다) */
  get size(): number {
    return this.exact.size + this.suffixes.length;
  }
}
