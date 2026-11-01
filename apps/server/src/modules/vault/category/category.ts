import { BaseEntity, DomainEvent, RuleViolation } from '../../platform';
import { type ChangeWork, GraphNode } from '../change/change-target';
import { SlugPolicy } from '../slug.policy';

// 그래프 카테고리: 지도의 구역. 사람이 만들고 AI는 제안만 한다 (AI의 category.create는 검토로 간다).
// wiki가 남아 있으면 지울 수 없다 (부모를 지워도 자식은 지워지지 않는다).
export class Category extends GraphNode {
  static readonly NAME_MAX = 100;
  static readonly DESCRIPTION_MAX = 2_000;
  static readonly SORT_MAX = 1_000_000;
  private static readonly COLOR_MAX = 40;

  readonly targetKind = 'category';

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    private nameValue: string,
    private slugValue: string,
    private readonly manualSlug: boolean,
    private colorValue: string | null,
    private descriptionValue: string | null,
    private sortValue: number,
    readonly origin: string,
    readonly pinned: boolean,
    deletedAt: Date | null,
    isNew: boolean,
  ) {
    super(id, version, isNew, deletedAt);
  }

  static open(
    work: ChangeWork,
    name: string,
    slug: string | null,
    color: string | null,
    description: string | null,
    sort: number,
  ): Category {
    const label = Category.checkName(name);
    const category = new Category(
      BaseEntity.newId(),
      1,
      work.spaceId,
      label,
      slug === null ? SlugPolicy.fromTitle(label) || 'category' : SlugPolicy.check(slug),
      slug !== null,
      Category.checkColor(color),
      description,
      sort,
      work.origin,
      work.human,
      null,
      true,
    );
    category.announce();
    return category;
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    name: string,
    slug: string,
    color: string | null,
    description: string | null,
    sort: number,
    origin: string,
    pinned: boolean,
    deletedAt: Date | null,
  ): Category {
    return new Category(
      id,
      version,
      spaceId,
      name,
      slug,
      true,
      color,
      description,
      sort,
      origin,
      pinned,
      deletedAt,
      false,
    );
  }

  get name(): string {
    return this.nameValue;
  }

  set name(value: string) {
    this.nameValue = Category.checkName(value);
    this.track('name', this.nameValue);
  }

  get slug(): string {
    return this.slugValue;
  }

  set slug(value: string) {
    this.slugValue = SlugPolicy.check(value);
    this.track('slug', this.slugValue);
  }

  get color(): string | null {
    return this.colorValue;
  }

  set color(value: string | null) {
    this.colorValue = Category.checkColor(value);
    this.track('color', value);
  }

  get description(): string | null {
    return this.descriptionValue;
  }

  set description(value: string | null) {
    this.descriptionValue = value;
    this.track('description', value);
  }

  get sort(): number {
    return this.sortValue;
  }

  set sort(value: number) {
    this.sortValue = value;
    this.track('sort', value);
  }

  /** 새 카테고리의 주소를 정한다. taken: 이 주소이거나 "이 주소-숫자"인 다른 카테고리의 주소들 */
  settleSlug(taken: ReadonlySet<string>): void {
    this.slugValue = SlugPolicy.pick(this.slugValue, taken, this.manualSlug);
  }

  /** 휴지통으로. 남은 wiki가 있는지는 Repository가 잠근 뒤 확인한다 (RESTRICT) */
  trash(work: ChangeWork): void {
    this.moveToTrash(work.now);
    this.announce();
  }

  /** 고친 것을 알린다. 칸을 set으로 바꾼 뒤 부른다 */
  announce(): void {
    this.record(
      new DomainEvent('vault.category.changed', 1, this.spaceId, {
        categoryId: this.id,
        name: this.nameValue,
        deleted: this.gone,
      }),
    );
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return {
      version: this.version,
      name: this.nameValue,
      slug: this.slugValue,
      color: this.colorValue,
      description: this.descriptionValue,
      sort: this.sortValue,
      deleted: this.gone,
    };
  }

  rollBack(before: Readonly<Record<string, unknown>> | null, work: ChangeWork): void {
    if (before === null) {
      this.trash(work);
      return;
    }
    if (before.deleted) this.moveToTrash(work.now);
    else this.takeOutOfTrash();
    this.name = String(before.name);
    this.slug = String(before.slug);
    this.color = before.color === null ? null : String(before.color);
    this.description = before.description === null ? null : String(before.description);
    this.sort = Number(before.sort);
    this.announce();
  }

  private static checkName(name: string): string {
    const label = name.trim();
    if (!label) throw new RuleViolation('이름을 써 주세요');
    if (label.length > Category.NAME_MAX)
      throw new RuleViolation(`이름은 ${Category.NAME_MAX}자까지예요`);
    return label;
  }

  private static checkColor(color: string | null): string | null {
    if (color !== null && color.length > Category.COLOR_MAX)
      throw new RuleViolation(`색은 ${Category.COLOR_MAX}자까지예요`);
    return color;
  }
}
