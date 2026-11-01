import { BaseEntity, DomainEvent, RuleViolation } from '../../platform';
import { ChangeWork, GraphNode } from '../change/change-target';
import { SlugPolicy } from '../slug.policy';
import { WikiBody } from './wiki-body';

/** wiki의 판 하나 (추가만). 고칠 때마다 덮어쓰지 않고 쌓는다 */
export class WikiRevision {
  constructor(
    readonly id: string,
    readonly seq: number,
    /** ai · human */
    readonly kind: string,
    readonly baseRevisionId: string | null,
    readonly changeSetId: string,
    readonly body: WikiBody,
    readonly actorType: string,
    readonly actorId: string | null,
    readonly createdAt: Date,
  ) {}
}

// wiki: 여러 세션을 모아 쓴 정리 문서. 본문은 판으로 쌓고, 사람이 고친 칸은 pinned_sections에 남아 AI가 바로 바꾸지 못한다.
// 새 wiki는 늘 비공개이고, 공개 여부는 사람만 바꾼다. 쓰기는 모두 변경 묶음(ChangeService)을 거친다.
export class Wiki extends GraphNode {
  static readonly PRIVATE = 'private';
  static readonly PUBLIC = 'public';
  static readonly VISIBILITIES: readonly string[] = [Wiki.PRIVATE, Wiki.PUBLIC];
  static readonly TITLE_MAX = 200;
  /** 사람이 정한 제목을 pinned_sections에 적는 이름. 칸 이름과 겹치지 않는다 */
  static readonly TITLE_KEY = '#title';

  readonly targetKind = 'wiki';
  private added: WikiRevision | null = null;

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    private titleValue: string,
    private slugValue: string,
    private readonly manualSlug: boolean,
    private categoryValue: string | null,
    private visibilityValue: string,
    readonly origin: string,
    private bodyValue: WikiBody,
    private headId: string | null,
    private pinned: readonly string[],
    private count: number,
    readonly createdAt: Date,
    private updatedValue: Date,
    deletedAt: Date | null,
    isNew: boolean,
  ) {
    super(id, version, isNew, deletedAt);
  }

  /** 새 wiki. 비공개로 시작하고, 사람이 쓴 칸은 처음부터 사람의 것이다 */
  static open(
    work: ChangeWork,
    title: string,
    body: WikiBody,
    slug: string | null,
    categoryId: string | null,
  ): Wiki {
    const name = Wiki.checkTitle(title);
    const wiki = new Wiki(
      BaseEntity.newId(),
      1,
      work.spaceId,
      name,
      slug === null ? SlugPolicy.fromTitle(name) || 'wiki' : SlugPolicy.check(slug),
      slug !== null,
      categoryId,
      Wiki.PRIVATE,
      work.origin,
      body,
      null,
      work.human ? [Wiki.TITLE_KEY, ...body.sections.map((s) => s.key)] : [],
      0,
      work.now,
      work.now,
      null,
      true,
    );
    wiki.addRevision(body, work);
    return wiki;
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    title: string,
    slug: string,
    categoryId: string | null,
    visibility: string,
    origin: string,
    body: WikiBody,
    headRevisionId: string | null,
    pinnedSections: readonly string[],
    revisionCount: number,
    createdAt: Date,
    updatedAt: Date,
    deletedAt: Date | null,
  ): Wiki {
    return new Wiki(
      id,
      version,
      spaceId,
      title,
      slug,
      true,
      categoryId,
      visibility,
      origin,
      body,
      headRevisionId,
      pinnedSections,
      revisionCount,
      createdAt,
      updatedAt,
      deletedAt,
      false,
    );
  }

  get title(): string {
    return this.titleValue;
  }

  get slug(): string {
    return this.slugValue;
  }

  get categoryId(): string | null {
    return this.categoryValue;
  }

  get visibility(): string {
    return this.visibilityValue;
  }

  get body(): WikiBody {
    return this.bodyValue;
  }

  get headRevisionId(): string | null {
    return this.headId;
  }

  get pinnedSections(): readonly string[] {
    return this.pinned;
  }

  get revisionCount(): number {
    return this.count;
  }

  get updatedAt(): Date {
    return this.updatedValue;
  }

  /** 이번에 새로 쌓인 판 (Repository가 저장한다) */
  get addedRevision(): WikiRevision | null {
    return this.added;
  }

  /** 저장이 끝난 뒤 Repository가 부른다 */
  revisionSaved(): void {
    this.added = null;
  }

  /** 새 wiki의 주소를 정한다. taken: 이 주소이거나 "이 주소-숫자"인 다른 wiki의 주소들 */
  settleSlug(taken: ReadonlySet<string>): void {
    this.slugValue = SlugPolicy.pick(this.slugValue, taken, this.manualSlug);
  }

  /** 이 제목·본문으로 바꾸면 사람이 고친 칸을 건드리는가 */
  touchesPinned(title: string, body: WikiBody): boolean {
    const keys = [
      ...body.changedFrom(this.bodyValue),
      ...(title.trim() === this.titleValue ? [] : [Wiki.TITLE_KEY]),
    ];
    return keys.some((key) => this.pinned.includes(key));
  }

  /** 제목·본문을 고친다. 본문이 다르면 새 판을 쌓고, 사람이 고쳤으면 바뀐 칸을 사람의 것으로 표시한다 */
  revise(title: string, body: WikiBody, work: ChangeWork): void {
    const name = Wiki.checkTitle(title);
    const keys = body.changedFrom(this.bodyValue);
    const renamed = name !== this.titleValue;
    if (renamed) {
      this.titleValue = name;
      this.track('title', name);
    }
    if (!body.sameAs(this.bodyValue)) this.addRevision(body, work);
    if (work.human) this.pin([...keys, ...(renamed ? [Wiki.TITLE_KEY] : [])]);
    if (this.changed) this.touch(work.now);
  }

  /** 공개 여부. 사람만 바꾼다 (AI는 묶음 판정에서 막히고, 여기가 마지막 벽이다) */
  setVisibility(visibility: string, work: ChangeWork): void {
    if (!work.human) throw new RuleViolation('공개 여부는 사람만 바꿔요');
    if (!Wiki.VISIBILITIES.includes(visibility))
      throw new RuleViolation(`공개 여부는 ${Wiki.VISIBILITIES.join(' · ')} 중 하나예요`);
    if (visibility === this.visibilityValue) return;
    this.visibilityValue = visibility;
    this.track('visibility', visibility);
    this.touch(work.now);
  }

  /** 대표 카테고리를 옮긴다. null이면 미분류 */
  moveTo(categoryId: string | null, work: ChangeWork): void {
    if (categoryId === this.categoryValue) return;
    this.categoryValue = categoryId;
    this.track('category_id', categoryId);
    this.touch(work.now);
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return {
      version: this.version,
      title: this.titleValue,
      body_md: this.bodyValue.markdown,
      category_id: this.categoryValue,
      visibility: this.visibilityValue,
      pinned_sections: this.pinned,
      deleted: this.gone,
    };
  }

  /** 앞 상태로 돌아간다. 판은 지우지 않고 앞 내용을 새 판으로 쌓는다. 이 묶음이 만든 wiki면 휴지통으로 */
  rollBack(before: Readonly<Record<string, unknown>> | null, work: ChangeWork): void {
    if (before === null) {
      this.moveToTrash(work.now);
      this.touch(work.now);
      return;
    }
    if (before.deleted) this.moveToTrash(work.now);
    else this.takeOutOfTrash();
    const title = String(before.title);
    if (title !== this.titleValue) {
      this.titleValue = title;
      this.track('title', title);
    }
    const body = WikiBody.parse(String(before.body_md));
    if (!body.sameAs(this.bodyValue)) this.addRevision(body, work);
    this.moveTo(before.category_id === null ? null : String(before.category_id), work);
    const visibility = String(before.visibility);
    if (visibility !== this.visibilityValue) {
      this.visibilityValue = visibility;
      this.track('visibility', visibility);
    }
    this.pinned = before.pinned_sections as string[];
    this.track('pinned_sections', this.pinned);
    this.touch(work.now);
  }

  private addRevision(body: WikiBody, work: ChangeWork): void {
    const revision = new WikiRevision(
      BaseEntity.newId(),
      this.count + 1,
      work.origin,
      this.headId,
      work.setId,
      body,
      work.actorType,
      work.actorId,
      work.now,
    );
    this.added = revision;
    this.headId = revision.id;
    this.count = revision.seq;
    this.bodyValue = body;
    this.track('head_revision_id', revision.id);
    this.track('head_text', body.markdown);
    this.track('revision_count', revision.seq);
    this.record(
      new DomainEvent('vault.wiki.saved', 1, this.spaceId, {
        wikiId: this.id,
        revisionId: revision.id,
        seq: revision.seq,
        kind: revision.kind,
        changeSetId: work.setId,
      }),
    );
  }

  private pin(keys: readonly string[]): void {
    const pinned = [...new Set([...this.pinned, ...keys])];
    if (pinned.length === this.pinned.length) return;
    this.pinned = pinned;
    this.track('pinned_sections', pinned);
  }

  private touch(now: Date): void {
    this.updatedValue = now;
    this.track('updated_at', now);
  }

  private static checkTitle(title: string): string {
    const name = title.trim();
    if (!name) throw new RuleViolation('제목을 써 주세요');
    if (name.length > Wiki.TITLE_MAX) throw new RuleViolation(`제목은 ${Wiki.TITLE_MAX}자까지예요`);
    return name;
  }
}
