import { BaseEntity, type ColumnRules, RuleViolation, TableEntity } from '../../platform';
import type { SpaceNew, SpaceRow } from '../account.tables';
import { type LoadedSpace, SpaceView } from './space.view';

// 블로그 공간 하나: 이름·소개와 사이트 주소(방문자가 들어오는 바깥 주소), 앱 연결 허용. 지금은 공간이 하나뿐이다.
// 이름만 spaces의 칸이고 나머지는 settings 표의 값이다. 저장할 때 설정을 모두 다시 적는다 (빈 값은 행을 지운다).
export class Space extends TableEntity<SpaceRow, SpaceNew> {
  static readonly SLUG = 'default';

  /** 주인이 정하는 칸과 그 규칙 */
  private static readonly RULES: ColumnRules<SpaceRow> = {
    name: (value) => value.trim(),
  };

  private constructor(
    row: SpaceRow | SpaceNew,
    private settings: Readonly<Record<string, unknown>>,
    fresh = false,
  ) {
    super(row, fresh);
  }

  static open(): Space {
    return new Space({ id: BaseEntity.newId(), slug: Space.SLUG, name: '' }, {}, true);
  }

  static restore(row: LoadedSpace): Space {
    return new Space(row, row.settings ?? {});
  }

  /** 칸이 그대로여도 저장하면 version이 오른다: 설정만 바뀌어도 화면이 든 공간은 옛것이 된다 */
  override get unsaved(): Partial<SpaceRow> {
    const changed = super.unsaved;
    return Object.keys(changed).length > 0 ? changed : { name: this.row.name };
  }

  /** 저장할 설정. null이면 그 행을 지운다. Repository가 부른다 */
  get unsavedSettings(): Readonly<Record<string, string | boolean | null>> {
    const view = this.view();
    return {
      [SpaceView.DESCRIPTION]: view.description || null,
      [SpaceView.SITE_URL]: view.siteUrl,
      [SpaceView.HOSTED_APPS]: view.hostedApps || null,
    };
  }

  /** 주인이 고친 칸 (이름) */
  edit(changes: Partial<SpaceRow>): void {
    this.accept(changes, Space.RULES);
  }

  /** 소개와 사이트 주소. siteUrl이 null이면 그대로 둔다 */
  describe(description: string, siteUrl: string | null): void {
    const site = siteUrl === null ? {} : { [SpaceView.SITE_URL]: Space.address(siteUrl) };
    this.settings = { ...this.settings, [SpaceView.DESCRIPTION]: description.trim(), ...site };
  }

  /** ChatGPT·Claude 앱 연결 허용 (왜 기본이 꺼짐인지는 SpaceView.hostedApps) */
  allowHostedApps(on: boolean): void {
    this.settings = { ...this.settings, [SpaceView.HOSTED_APPS]: on };
  }

  /** installed: 주인이 있는가. 저장한 공간은 주인만 고칠 수 있으니 설치가 끝난 공간이다 */
  view(installed = true): SpaceView {
    return new SpaceView({ ...this.row, settings: this.settings }, installed);
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
