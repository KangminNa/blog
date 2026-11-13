import { Actor, type AgentActor, RuleViolation } from '../../platform';

// 주소 읽기(read_url)의 목줄 한 곳 (기획서 결정 2026-11-13). 서버가 AI 대신 주소를 열 때 어디까지 열지 정한다.
//   비공개를 볼 수 없는 일 (전체 읽기 · 쓰기 · 코드 권한이 없고, 재료 읽기 허락도 없음): 공개 주소 어디든.
//     AI가 아는 것이 주인이 쓴 지시뿐이라 주소에 실어 내보낼 우리 정보가 없다
//   비공개를 볼 수 있는 일: 주인이 맡긴 지시(위임된 일이면 맨 위 일의 지시)에 적힌 사이트와 그 하위 주소만.
//     AI가 고른 주소(https://나쁜곳/?q=<비공개>)로 정보를 내보내지 못하게
// 내부망 · 이 서버는 어느 쪽이든 열지 않는다 (WebPageGateway가 주소를 풀어 본다)
export class WebReach {
  /** 이 권한 중 하나라도 있으면 비공개(세션 · 위키 · 초안 · 소재 · 저장소)를 볼 수 있다 */
  static readonly PRIVATE_SCOPES: readonly string[] = [Actor.READ_ALL, Actor.WRITE, Actor.CODE];
  /** 글 안의 주소: 스킴이 있는 것과 www.로 시작하는 것 */
  private static readonly LINK = /\bhttps?:\/\/[^\s<>"'`)\]}]+|\bwww\.[^\s<>"'`)\]}/]+/gi;

  private constructor(
    readonly open: boolean,
    private readonly hosts: ReadonlySet<string>,
  ) {}

  /** ownerText: 주인이 쓴 지시 (맨 위 일의 제목과 지시) */
  static of(actor: AgentActor, ownerText: string): WebReach {
    const sees = WebReach.PRIVATE_SCOPES.some((scope) => actor.can(scope)) || actor.hasReadGrants();
    return new WebReach(!sees, WebReach.hostsIn(ownerText));
  }

  /** 글에 적힌 주소의 사이트 (소문자, 앞의 www. 없이) */
  static hostsIn(text: string): Set<string> {
    const hosts = new Set<string>();
    for (const [raw] of text.matchAll(WebReach.LINK)) {
      const link = raw.replace(/[.,;:!?]+$/, '');
      try {
        hosts.add(WebReach.site(new URL(/^https?:/i.test(link) ? link : `https://${link}`)));
      } catch {
        // 주소 모양이 아니면 건너뛴다
      }
    }
    return hosts;
  }

  /** 열어도 되는 주소인지. 안 되면 AI가 읽을 이유와 함께 RuleViolation */
  assertAllowed(url: URL): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new RuleViolation('http · https 주소만 열 수 있어요');
    if (url.username || url.password)
      throw new RuleViolation('아이디 · 비밀번호가 든 주소는 열 수 없어요');
    if (this.open) return;
    const site = WebReach.site(url);
    for (const host of this.hosts) if (site === host || site.endsWith(`.${host}`)) return;
    throw new RuleViolation(
      this.hosts.size === 0
        ? '이 일은 비공개를 볼 수 있어 지시에 적힌 사이트만 열 수 있는데, 지시에 주소가 없어요. 주인에게 주소를 받아야 해요'
        : `지시에 없는 사이트예요 (열 수 있는 곳: ${[...this.hosts].join(', ')})`,
    );
  }

  private static site(url: URL): string {
    return url.hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
  }
}
