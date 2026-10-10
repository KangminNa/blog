import { BaseEntity, RuleViolation } from '../../platform';

// 블로그 공간 하나: 이름·소개와 사이트 주소(방문자가 들어오는 바깥 주소). 지금은 공간이 하나뿐이다.
export class Space extends BaseEntity {
  static readonly SLUG = 'default';

  private constructor(
    id: string,
    version: number,
    readonly slug: string,
    private nameValue: string,
    private descriptionValue: string,
    private site: string | null,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  static open(): Space {
    return new Space(BaseEntity.newId(), 1, Space.SLUG, '', '', null, true);
  }

  static restore(
    id: string,
    version: number,
    slug: string,
    name: string,
    description: string,
    site: string | null,
  ): Space {
    return new Space(id, version, slug, name, description, site, false);
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

  /** siteUrl이 null이면 그대로 둔다 */
  rename(name: string, description: string, siteUrl: string | null): void {
    this.nameValue = name.trim();
    this.descriptionValue = description.trim();
    if (siteUrl !== null) this.site = Space.address(siteUrl);
  }

  /** http(s)로 시작하는 주소만. 끝의 / 는 뗀다 */
  private static address(value: string): string {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new RuleViolation(`주소 모양이 아니에요: ${value}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new RuleViolation('http:// 또는 https://로 시작하는 주소로 넣어 주세요');
    if (url.search || url.hash) throw new RuleViolation('?나 # 없이 넣어 주세요');
    return url.toString().replace(/\/+$/, '');
  }
}
