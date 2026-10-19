import { BaseEntity, RuleViolation } from '../../platform';

// 블로그 공간 하나: 이름·소개와 사이트 주소(방문자가 들어오는 바깥 주소), 앱 연결 허용. 지금은 공간이 하나뿐이다.
export class Space extends BaseEntity {
  static readonly SLUG = 'default';

  private constructor(
    id: string,
    version: number,
    readonly slug: string,
    private nameValue: string,
    private descriptionValue: string,
    private site: string | null,
    private hostedAppsOn: boolean,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  static open(): Space {
    return new Space(BaseEntity.newId(), 1, Space.SLUG, '', '', null, false, true);
  }

  static restore(
    id: string,
    version: number,
    slug: string,
    name: string,
    description: string,
    site: string | null,
    hostedApps: boolean,
  ): Space {
    return new Space(id, version, slug, name, description, site, hostedApps, false);
  }

  get name(): string {
    return this.nameValue;
  }

  get description(): string {
    return this.descriptionValue;
  }

  get siteUrl(): string | null {
    return this.site;
  }

  /**
   * ChatGPT·Claude 앱(웹·데스크톱 채팅)의 연결을 받는가. 기본은 꺼짐.
   * 이 앱들은 로그인 열쇠를 chatgpt.com·claude.ai로 돌려받아서, 남이 시작한 연결을 승인하면 그 사람 계정이 붙는다.
   * 그래서 쓰는 사람만 켜고, 켜도 승인 화면이 앱 연결임을 알린다.
   */
  get hostedApps(): boolean {
    return this.hostedAppsOn;
  }

  allowHostedApps(on: boolean): void {
    this.hostedAppsOn = on;
  }

  /** siteUrl이 null이면 그대로 둔다 */
  rename(name: string, description: string, siteUrl: string | null): void {
    this.nameValue = name.trim();
    this.descriptionValue = description.trim();
    if (siteUrl !== null) this.site = Space.address(siteUrl);
  }

  /**
   * https 주소만. 비밀번호·로그인 쿠키·기기 토큰이 그대로 오가지 않게 한다.
   * 이 컴퓨터 안에서만 쓰는 개발 주소(localhost · 127.0.0.1 · [::1] · *.localhost)는 http도 된다.
   * 끝의 / 는 뗀다.
   */
  private static address(value: string): string {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new RuleViolation(`주소 모양이 아니에요: ${value}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new RuleViolation('https://로 시작하는 주소로 넣어 주세요');
    if (url.protocol === 'http:' && !Space.isLocal(url.hostname))
      throw new RuleViolation('https 주소만 쓸 수 있어요 (localhost는 http도 가능)');
    if (url.search || url.hash) throw new RuleViolation('?나 # 없이 넣어 주세요');
    return url.toString().replace(/\/+$/, '');
  }

  private static isLocal(hostname: string): boolean {
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost')
    );
  }
}
