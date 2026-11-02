import { RequestFields, RuleViolation } from '../../platform';
import { Category } from '../category/category';
import { Edge, type EdgeKind } from '../edge/edge';
import { Session } from '../session/session';
import type { CategoryRow, ChangeOpRow } from '../vault.tables';
import { Wiki } from '../wiki/wiki';
import { WikiBody } from '../wiki/wiki-body';
import type { ChangeTarget, ChangeWork } from './change-target';
import type { Verdict } from './review.policy';

/** change_ops의 칸 중 판정과 결정이 채우는 것 */
type ChangeOpState = Omit<ChangeOpRow, 'change_set_id' | 'seq' | 'op' | 'target_kind' | 'payload'>;

/**
 * 한 묶음이 잠근 대상들. Repository가 고정된 순서로 잠가 채우고, 변경은 여기서 자기 대상을 찾는다.
 * 자리(place)는 `종류:id` 글자다: 글자 순으로 정렬하면 종류, 그다음 id 순이라 어디서나 같은 순서로 잠근다.
 */
export class TargetBoard {
  private readonly found = new Map<string, ChangeTarget | null>();
  /** 잠글 때의 version. 같은 묶음의 앞 변경이 올린 것은 "그사이 바뀐 것"이 아니다 */
  private readonly locked = new Map<string, number>();
  /** 이 묶음에서 만든 대상 (변경 번호 → 대상). `@번호`로 가리킨다 */
  private readonly made = new Map<number, ChangeTarget>();
  private live: ReadonlySet<string> = new Set();

  constructor(private readonly kinds: ReadonlyMap<string, EdgeKind>) {}

  static place(kind: string, id: string): string {
    return `${kind}:${id}`;
  }

  edgeKind(name: string): EdgeKind | null {
    return this.kinds.get(name) ?? null;
  }

  put(place: string, target: ChangeTarget | null): void {
    this.found.set(place, target);
    if (target) this.locked.set(place, target.version);
  }

  markLive(ids: ReadonlySet<string>): void {
    this.live = ids;
  }

  at(place: string): ChangeTarget | null {
    return this.found.get(place) ?? null;
  }

  lockedVersion(place: string): number | null {
    return this.locked.get(place) ?? null;
  }

  /** 적용한 대상을 남겨 둔다: 뒤 변경이 `@번호`나 자리로 찾는다 */
  keep(seq: number, place: string | null, target: ChangeTarget): void {
    this.made.set(seq, target);
    this.found.set(TargetBoard.place(target.targetKind, target.id), target);
    if (place) this.found.set(place, target);
  }

  /** 가리킨 점을 찾는다: 이 묶음에서 만든 `@번호`나 잠근 대상. 없거나 지웠으면 null */
  pick(kind: string, ref: string): ChangeTarget | null {
    const target = ChangeOp.isMade(ref)
      ? (this.made.get(Number(ref.slice(1))) ?? null)
      : this.at(TargetBoard.place(kind, ref));
    return target?.targetKind === kind && !target.gone ? target : null;
  }

  /** 선의 끝이 될 점의 id. 없거나 지웠으면 null */
  node(ref: string): string | null {
    if (!ChangeOp.isMade(ref)) return this.live.has(ref) ? ref : null;
    const made = this.made.get(Number(ref.slice(1)));
    return made && made.targetKind !== 'edge' ? made.id : null;
  }
}

// 묶음 안의 변경 하나. git의 커밋 안 파일 변경처럼 요청한 일이다. 실제로 바뀐 행의 전/후는 vault.changes에 남는다.
// 무엇을 건드리는지 사실만 알려 주고, 바로 합칠지는 ReviewPolicy가 정한다. 적용은 엔티티의 메서드로만 한다.
export abstract class ChangeOp {
  static readonly PENDING = 'pending';
  static readonly APPLIED = 'applied';
  static readonly WAITING = 'waiting';
  static readonly DECLINED = 'declined';
  static readonly REJECTED = 'rejected';
  static readonly SUPERSEDED = 'superseded';
  /** payload에서 앞 변경이 만든 것을 가리키는 값 (예: `@1`) */
  private static readonly MADE = /^@[1-9]\d{0,3}$/;

  abstract readonly name: string;
  abstract readonly targetKind: string;
  /** bind가 찾은 대상. 새로 만드는 변경은 적용한 뒤에 채운다 */
  target: ChangeTarget | null = null;
  /** bind가 찾은 대상의 자리 */
  place: string | null = null;
  /** 대상이나 가리킨 점이 없다 */
  missing = false;
  /** AI가 본 version과 잠글 때의 version이 다르다 */
  stale = false;

  private state: ChangeOpState;
  private touched = true;

  protected constructor(
    readonly seq: number,
    targetId: string | null,
    baseVersion: number | null,
  ) {
    this.state = {
      target_id: targetId,
      base_version: baseVersion,
      verdict: null,
      rule: null,
      status: ChangeOp.PENDING,
      reason: null,
      decided_at: null,
      decided_by: null,
    };
  }

  /** 이 묶음에서 만든 것을 가리키는 값인가 */
  static isMade(ref: string): boolean {
    return ChangeOp.MADE.test(ref);
  }

  /** 대상이 있어야 하는 변경인가 (새로 만드는 변경은 아니다) */
  protected get needsTarget(): boolean {
    return true;
  }

  get targetId(): string | null {
    return this.state.target_id;
  }

  /** 판정할 때 대상의 version. 승인할 때 이 값과 비교해 그사이 바뀌었는지 본다 */
  get baseVersion(): number | null {
    return this.state.base_version;
  }

  get status(): string {
    return this.state.status;
  }

  /** 저장해야 하는가 (Repository가 본다) */
  get dirty(): boolean {
    return this.touched;
  }

  get waiting(): boolean {
    return this.state.status === ChangeOp.WAITING;
  }

  get applied(): boolean {
    return this.state.status === ChangeOp.APPLIED;
  }

  /** 판정한 뒤 대상이 바뀌었는가: 없어졌거나 version이 달라졌다 */
  get moved(): boolean {
    return (this.target?.version ?? null) !== this.state.base_version;
  }

  /** change_ops 한 줄 */
  toRow(setId: string): ChangeOpRow {
    return {
      ...this.state,
      change_set_id: setId,
      seq: this.seq,
      op: this.name,
      target_kind: this.targetKind,
      payload: this.toPayload(),
    };
  }

  /** vault.changes.op */
  recordAs(before: Readonly<Record<string, unknown>> | null): string {
    return before === null ? 'insert' : 'update';
  }

  /** 잠글 자리들: 대상 + 가리키는 점 */
  places(_board: TargetBoard): readonly string[] {
    const id = this.state.target_id;
    return id ? [TargetBoard.place(this.targetKind, id)] : [];
  }

  /** 살아 있는지 볼 점들 (잠그지 않는다) */
  nodes(): readonly string[] {
    return [];
  }

  /** 잠근 대상을 찾아 둔다. 판정과 적용은 이 뒤에 한다 */
  bind(board: TargetBoard): void {
    const id = this.state.target_id;
    this.attach(board, id ? TargetBoard.place(this.targetKind, id) : null);
  }

  /** 없거나 지운 대상이면 missing. AI가 적은 version이 잠글 때와 다르면 stale */
  protected attach(board: TargetBoard, place: string | null): void {
    this.place = place;
    this.target = place ? board.at(place) : null;
    this.missing = this.needsTarget && (this.target === null || this.target.gone);
    const seen = this.state.base_version;
    this.stale = seen !== null && place !== null && board.lockedVersion(place) !== seen;
  }

  /** 없던 것을 더하는가 */
  adds(_target: ChangeTarget | null): boolean {
    return false;
  }

  /** AI가 만든 것을 고치는가 */
  editsOwn(_target: ChangeTarget | null): boolean {
    return false;
  }

  /** 사람이 정한 것을 건드리는가 */
  touchesHuman(_target: ChangeTarget | null): boolean {
    return false;
  }

  /** 사람이 지운 것을 되살리는가 */
  revivesHumanDeleted(_target: ChangeTarget | null): boolean {
    return false;
  }

  /** 카테고리 구조를 바꾸는가 */
  get changesStructure(): boolean {
    return false;
  }

  /** 공개 여부를 정하려 하는가 */
  get asksPublish(): boolean {
    return false;
  }

  /** 민감정보를 지운다. 글을 받는 변경만 덮어쓴다 */
  clean(_scrub: (text: string) => string): void {}

  /** 대상에게 시킨다. 새로 만드는 변경은 만든 대상을 돌려준다 */
  abstract apply(work: ChangeWork): ChangeTarget;

  /** change_ops.payload */
  abstract toPayload(): Record<string, unknown>;

  /** 규칙의 판정을 적는다. 대상의 지금 version이 이후의 기준이 된다 */
  judge(verdict: Verdict): void {
    this.write({
      verdict: verdict.action,
      rule: verdict.rule,
      reason: verdict.reason,
      status: verdict.status,
      base_version: this.target?.version ?? null,
      target_id: this.state.target_id ?? this.target?.id ?? null,
    });
  }

  /** 적용이 끝났다 */
  settled(target: ChangeTarget): void {
    this.target = target;
    this.write({ target_id: target.id });
  }

  approve(by: string | null, now: Date): void {
    this.close(ChangeOp.APPLIED, by, now, this.state.reason);
  }

  decline(by: string | null, now: Date): void {
    this.close(ChangeOp.DECLINED, by, now, this.state.reason);
  }

  supersede(by: string | null, now: Date, reason: string): void {
    this.close(ChangeOp.SUPERSEDED, by, now, reason);
  }

  /** 저장된 판정을 되살린다 (Repository만) */
  restored(row: Readonly<ChangeOpRow>): this {
    const { verdict, rule, status, reason, decided_at, decided_by } = row;
    this.write({ verdict, rule, status, reason, decided_at, decided_by });
    this.touched = false;
    return this;
  }

  /** 저장이 끝난 뒤 Repository가 부른다 */
  saved(): void {
    this.touched = false;
  }

  private close(status: string, by: string | null, now: Date, reason: string | null): void {
    this.write({ status, reason, decided_at: now, decided_by: by });
  }

  private write(changes: Partial<ChangeOpState>): void {
    this.state = { ...this.state, ...changes };
    this.touched = true;
  }
}

/** 새 wiki. 늘 비공개로 시작한다. 카테고리는 사람만 함께 정한다 (AI는 category.assign으로 제안) */
export class WikiCreateOp extends ChangeOp {
  static readonly NAME = 'wiki.create';
  readonly name = WikiCreateOp.NAME;
  readonly targetKind = 'wiki';

  constructor(
    seq: number,
    targetId: string | null,
    private title: string,
    private body: WikiBody,
    private readonly slug: string | null,
    private readonly categoryId: string | null,
    private readonly visibility: string | null,
  ) {
    super(seq, targetId, null);
  }

  protected override get needsTarget(): boolean {
    return false;
  }

  override get asksPublish(): boolean {
    return this.visibility !== null;
  }

  override places(board: TargetBoard): readonly string[] {
    const category = this.categoryId ? [TargetBoard.place('category', this.categoryId)] : [];
    return [...super.places(board), ...category];
  }

  override bind(board: TargetBoard): void {
    super.bind(board);
    if (this.categoryId && !board.pick('category', this.categoryId)) this.missing = true;
  }

  override adds(): boolean {
    return true;
  }

  override clean(scrub: (text: string) => string): void {
    this.title = scrub(this.title);
    this.body = WikiBody.parse(scrub(this.body.markdown));
  }

  apply(work: ChangeWork): ChangeTarget {
    return Wiki.open(work, this.title, this.body, this.slug, this.categoryId);
  }

  toPayload(): Record<string, unknown> {
    return {
      title: this.title,
      body_md: this.body.markdown,
      slug: this.slug,
      category_id: this.categoryId,
      visibility: this.visibility,
    };
  }
}

/** wiki의 본문(과 제목)을 통째로 새로 쓴다. 바뀐 칸은 서버가 지금 판과 비교해 찾는다. 공개 여부는 사람만 함께 정한다 */
export class WikiReviseOp extends ChangeOp {
  static readonly NAME = 'wiki.revise';
  readonly name = WikiReviseOp.NAME;
  readonly targetKind = 'wiki';

  constructor(
    seq: number,
    targetId: string,
    baseVersion: number | null,
    private title: string | null,
    private body: WikiBody,
    private readonly visibility: string | null,
  ) {
    super(seq, targetId, baseVersion);
  }

  override get asksPublish(): boolean {
    return this.visibility !== null;
  }

  override touchesHuman(target: ChangeTarget | null): boolean {
    return target instanceof Wiki && target.touchesPinned(this.title ?? target.title, this.body);
  }

  override editsOwn(target: ChangeTarget | null): boolean {
    return target instanceof Wiki && !this.touchesHuman(target);
  }

  override clean(scrub: (text: string) => string): void {
    this.title = this.title === null ? null : scrub(this.title);
    this.body = WikiBody.parse(scrub(this.body.markdown));
  }

  apply(work: ChangeWork): ChangeTarget {
    const wiki = this.target as Wiki;
    wiki.revise(this.title ?? wiki.title, this.body, work);
    if (this.visibility !== null) wiki.setVisibility(this.visibility, work);
    return wiki;
  }

  toPayload(): Record<string, unknown> {
    return { title: this.title, body_md: this.body.markdown, visibility: this.visibility };
  }
}

/** 세션의 대표 wiki를 정한다. null이면 도착 구역으로 */
export class SessionAssignOp extends ChangeOp {
  static readonly NAME = 'session.assign';
  readonly name = SessionAssignOp.NAME;
  readonly targetKind = 'session';

  constructor(
    seq: number,
    targetId: string,
    baseVersion: number | null,
    /** wiki id나 `@번호` */
    private wikiRef: string | null,
  ) {
    super(seq, targetId, baseVersion);
  }

  override places(board: TargetBoard): readonly string[] {
    const wiki =
      this.wikiRef && !ChangeOp.isMade(this.wikiRef)
        ? [TargetBoard.place('wiki', this.wikiRef)]
        : [];
    return [...super.places(board), ...wiki];
  }

  override bind(board: TargetBoard): void {
    super.bind(board);
    if (this.wikiRef === null) return;
    const wiki = board.pick('wiki', this.wikiRef);
    if (wiki) this.wikiRef = wiki.id;
    else this.missing = true;
  }

  override adds(target: ChangeTarget | null): boolean {
    return target instanceof Session && target.wikiId === null;
  }

  override editsOwn(target: ChangeTarget | null): boolean {
    return target instanceof Session && target.wikiId !== null;
  }

  override touchesHuman(target: ChangeTarget | null): boolean {
    return target instanceof Session && target.wikiPinned;
  }

  apply(work: ChangeWork): ChangeTarget {
    const session = this.target as Session;
    session.assignTo(this.wikiRef, work);
    return session;
  }

  toPayload(): Record<string, unknown> {
    return { wiki_id: this.wikiRef };
  }
}

/** 선을 가리키는 변경. 선은 양 끝과 종류로 찾는다 (사람이 지운 행도 이 자리에 남아 있다) */
abstract class EdgeOp extends ChangeOp {
  readonly targetKind = 'edge';

  protected constructor(
    seq: number,
    baseVersion: number | null,
    /** 점 id나 `@번호`. 찾은 뒤에는 저장할 때의 순서로 바뀐다 */
    protected src: string,
    protected dst: string,
    protected readonly kind: string,
  ) {
    super(seq, null, baseVersion);
  }

  /** 잠글 자리. 끝이 이 묶음에서 새로 만든 점이면 선이 있을 수 없어 자리가 없다 */
  private placeOn(board: TargetBoard): string | null {
    const kind = board.edgeKind(this.kind);
    if (!kind || ChangeOp.isMade(this.src) || ChangeOp.isMade(this.dst)) return null;
    const [from, to] = kind.ends(this.src, this.dst);
    return TargetBoard.place('edge', `${from}:${to}:${this.kind}`);
  }

  override places(board: TargetBoard): readonly string[] {
    const place = this.placeOn(board);
    return place ? [place] : [];
  }

  override nodes(): readonly string[] {
    return [this.src, this.dst].filter((ref) => !ChangeOp.isMade(ref));
  }

  override bind(board: TargetBoard): void {
    const kind = board.edgeKind(this.kind);
    const src = board.node(this.src);
    const dst = board.node(this.dst);
    if (src && dst && kind) [this.src, this.dst] = kind.ends(src, dst);
    this.attach(board, src && dst ? this.placeOn(board) : null);
    if (!src || !dst || !kind || !this.allowed(kind)) this.missing = true;
  }

  /** 이 종류의 선을 다룰 수 있는가 */
  protected allowed(_kind: EdgeKind): boolean {
    return true;
  }

  toPayload(): Record<string, unknown> {
    return { src: this.src, dst: this.dst, kind: this.kind };
  }
}

/** 선을 더한다. 이미 있으면 그대로, 지운 선이면 되살린다 (사람이 지운 선을 AI가 되살리는 일은 규칙이 막는다) */
export class EdgeAddOp extends EdgeOp {
  static readonly NAME = 'edge.add';
  readonly name = EdgeAddOp.NAME;

  constructor(
    seq: number,
    baseVersion: number | null,
    src: string,
    dst: string,
    kind: string,
    /** 사람은 AI가 못 만드는 종류도 만든다 */
    private readonly byHuman: boolean,
  ) {
    super(seq, baseVersion, src, dst, kind);
  }

  protected override get needsTarget(): boolean {
    return false;
  }

  protected override allowed(kind: EdgeKind): boolean {
    return this.byHuman || kind.aiCreatable;
  }

  override adds(target: ChangeTarget | null): boolean {
    return !(target instanceof Edge && target.humanDeleted);
  }

  override revivesHumanDeleted(target: ChangeTarget | null): boolean {
    return target instanceof Edge && target.humanDeleted;
  }

  apply(work: ChangeWork): ChangeTarget {
    const edge = this.target as Edge | null;
    if (edge) {
      edge.revive(work);
      return edge;
    }
    return Edge.open(work, this.src, this.dst, this.kind);
  }
}

/** 선을 지운다. 행은 남는다 */
export class EdgeRemoveOp extends EdgeOp {
  static readonly NAME = 'edge.remove';
  readonly name = EdgeRemoveOp.NAME;

  constructor(seq: number, baseVersion: number | null, src: string, dst: string, kind: string) {
    super(seq, baseVersion, src, dst, kind);
  }

  override recordAs(): string {
    return 'delete';
  }

  override touchesHuman(target: ChangeTarget | null): boolean {
    return target instanceof Edge && target.humanOwned;
  }

  override editsOwn(target: ChangeTarget | null): boolean {
    return target instanceof Edge && !target.humanOwned;
  }

  apply(work: ChangeWork): ChangeTarget {
    const edge = this.target as Edge;
    edge.remove(work);
    return edge;
  }
}

/** 새 카테고리. AI가 만들면 기본은 검토 */
export class CategoryCreateOp extends ChangeOp {
  static readonly NAME = 'category.create';
  readonly name = CategoryCreateOp.NAME;
  readonly targetKind = 'category';

  constructor(
    seq: number,
    targetId: string | null,
    /** 주소가 없으면 이름에서 만든다 */
    private fields: Partial<CategoryRow>,
  ) {
    super(seq, targetId, null);
  }

  protected override get needsTarget(): boolean {
    return false;
  }

  override get changesStructure(): boolean {
    return true;
  }

  override clean(scrub: (text: string) => string): void {
    const { name, description } = this.fields;
    this.fields = {
      ...this.fields,
      name: scrub(name ?? ''),
      description: description ? scrub(description) : description,
    };
  }

  apply(work: ChangeWork): ChangeTarget {
    return Category.open(work, this.fields);
  }

  toPayload(): Record<string, unknown> {
    const { name, slug, color, description, sort } = this.fields;
    return {
      name,
      slug: slug ?? null,
      color: color ?? null,
      description: description ?? null,
      sort: sort ?? 0,
    };
  }
}

/** wiki의 대표 카테고리를 정한다. null이면 미분류. 대상은 wiki다 */
export class CategoryAssignOp extends ChangeOp {
  static readonly NAME = 'category.assign';
  readonly name = CategoryAssignOp.NAME;
  readonly targetKind = 'wiki';

  constructor(
    seq: number,
    targetId: string,
    baseVersion: number | null,
    /** 카테고리 id나 `@번호` */
    private categoryRef: string | null,
  ) {
    super(seq, targetId, baseVersion);
  }

  override get changesStructure(): boolean {
    return true;
  }

  override places(board: TargetBoard): readonly string[] {
    const category =
      this.categoryRef && !ChangeOp.isMade(this.categoryRef)
        ? [TargetBoard.place('category', this.categoryRef)]
        : [];
    return [...super.places(board), ...category];
  }

  override bind(board: TargetBoard): void {
    super.bind(board);
    if (this.categoryRef === null) return;
    const category = board.pick('category', this.categoryRef);
    if (category) this.categoryRef = category.id;
    else this.missing = true;
  }

  apply(work: ChangeWork): ChangeTarget {
    const wiki = this.target as Wiki;
    wiki.moveTo(this.categoryRef, work);
    return wiki;
  }

  toPayload(): Record<string, unknown> {
    return { category_id: this.categoryRef };
  }
}

/** 카테고리의 칸을 고친다. 사람만 (관리 화면). 없는 칸은 그대로 둔다 */
export class CategoryUpdateOp extends ChangeOp {
  static readonly NAME = 'category.update';
  readonly name = CategoryUpdateOp.NAME;
  readonly targetKind = 'category';

  constructor(
    seq: number,
    targetId: string,
    baseVersion: number,
    private readonly changes: Partial<CategoryRow>,
  ) {
    super(seq, targetId, baseVersion);
  }

  apply(): ChangeTarget {
    const category = this.target as Category;
    category.edit(this.changes);
    if (category.changed) category.announce();
    return category;
  }

  toPayload(): Record<string, unknown> {
    const { name, slug, color, description, sort } = this.changes;
    return { name: name ?? null, slug: slug ?? null, color, description, sort: sort ?? null };
  }
}

/** 카테고리를 휴지통으로. 사람만 (관리 화면). wiki가 남아 있으면 지우지 못한다 */
export class CategoryDeleteOp extends ChangeOp {
  static readonly NAME = 'category.delete';
  readonly name = CategoryDeleteOp.NAME;
  readonly targetKind = 'category';

  constructor(seq: number, targetId: string, baseVersion: number) {
    super(seq, targetId, baseVersion);
  }

  override recordAs(): string {
    return 'delete';
  }

  apply(work: ChangeWork): ChangeTarget {
    const category = this.target as Category;
    category.trash(work);
    return category;
  }

  toPayload(): Record<string, unknown> {
    return {};
  }
}

/** 앞 묶음이 바꾼 대상 하나를 그 앞 상태로 돌린다. 판은 지우지 않고 새로 쌓는다 */
export class RevertOp extends ChangeOp {
  static readonly NAME = 'revert';
  readonly name = RevertOp.NAME;

  constructor(
    seq: number,
    readonly targetKind: string,
    targetId: string,
    /** 앞 묶음이 남긴 version. 지금 대상이 이 version이 아니면 그사이 바뀐 것이다 */
    baseVersion: number,
    private readonly before: Readonly<Record<string, unknown>> | null,
  ) {
    super(seq, targetId, baseVersion);
  }

  /**
   * vault.changes 행들(오래된 순)을 대상마다 하나로 모은다: 맨 처음의 before로 돌아가고, 맨 끝의 version과 비교한다.
   * 나중에 바뀐 대상부터 되돌린다: 카테고리에 넣은 wiki를 먼저 빼야 그 카테고리를 지울 수 있다.
   */
  static squash(rows: readonly RevertOp[]): RevertOp[] {
    const merged = new Map<string, RevertOp>();
    for (const row of rows) {
      const key = TargetBoard.place(row.targetKind, String(row.targetId));
      const first = merged.get(key);
      merged.delete(key);
      merged.set(key, first ? first.until(row) : row);
    }
    return [...merged.values()].reverse().map((op, i) => op.numbered(i + 1));
  }

  /** 지운 대상도 돌려놓을 수 있다 */
  protected override attach(board: TargetBoard, place: string | null): void {
    super.attach(board, place);
    this.missing = this.target === null;
  }

  override recordAs(): string {
    return 'restore';
  }

  apply(work: ChangeWork): ChangeTarget {
    const target = this.target as ChangeTarget;
    target.rollBack(this.before, work);
    return target;
  }

  toPayload(): Record<string, unknown> {
    return { before: this.before };
  }

  private until(last: RevertOp): RevertOp {
    return new RevertOp(
      this.seq,
      this.targetKind,
      String(this.targetId),
      Number(last.baseVersion),
      this.before,
    );
  }

  private numbered(seq: number): RevertOp {
    return new RevertOp(
      seq,
      this.targetKind,
      String(this.targetId),
      Number(this.baseVersion),
      this.before,
    );
  }
}

/** 이미 끝난 변경: 기록을 보여 주기만 한다 (대기 중인 변경만 다시 적용할 수 있다) */
export class SettledOp extends ChangeOp {
  constructor(
    seq: number,
    readonly name: string,
    readonly targetKind: string,
    targetId: string | null,
    baseVersion: number | null,
    private readonly payload: Record<string, unknown>,
  ) {
    super(seq, targetId, baseVersion);
  }

  protected override get needsTarget(): boolean {
    return false;
  }

  apply(): ChangeTarget {
    throw new RuleViolation('이미 끝난 변경이에요');
  }

  toPayload(): Record<string, unknown> {
    return this.payload;
  }
}

/** 변경을 모양에서 조립하는 곳: AI의 입력과, 기다리는 변경을 저장소에서 되살릴 때 같은 길을 쓴다 */
// biome-ignore lint/complexity/noStaticOnlyClass: 변경 종류 목록 한 곳. 입력과 Repository가 함께 쓴다
export class ChangeOps {
  /** AI가 낼 수 있는 변경. category.update · category.delete · revert는 사람의 일이라 없다 */
  static readonly FOR_AI: readonly string[] = [
    WikiCreateOp.NAME,
    WikiReviseOp.NAME,
    SessionAssignOp.NAME,
    EdgeAddOp.NAME,
    EdgeRemoveOp.NAME,
    CategoryCreateOp.NAME,
    CategoryAssignOp.NAME,
  ];
  private static readonly ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** AI가 낸 변경 하나의 칸을 읽는다. 틀린 칸은 p·item에 모인다. 모르는 이름이면 null */
  static read(
    name: string,
    seq: number,
    targetId: string | null,
    baseVersion: number | null,
    p: RequestFields,
    item: RequestFields,
  ): ChangeOp | null {
    const target = (): string => {
      if (targetId === null) item.reject('target_id', `${name}에는 대상이 필요해요`);
      return targetId ?? '';
    };
    switch (name) {
      case WikiCreateOp.NAME:
        return new WikiCreateOp(
          seq,
          null,
          p.text('title', Wiki.TITLE_MAX),
          WikiBody.parse(p.text('body_md', WikiBody.MAX)),
          null,
          null,
          p.optionalText('visibility', 20),
        );
      case WikiReviseOp.NAME:
        return new WikiReviseOp(
          seq,
          target(),
          baseVersion,
          p.optionalText('title', Wiki.TITLE_MAX),
          WikiBody.parse(p.text('body_md', WikiBody.MAX)),
          p.optionalText('visibility', 20),
        );
      case SessionAssignOp.NAME:
        return new SessionAssignOp(seq, target(), baseVersion, ChangeOps.ref(p, 'wiki_id'));
      case EdgeAddOp.NAME:
        return new EdgeAddOp(
          seq,
          baseVersion,
          ChangeOps.ref(p, 'src'),
          ChangeOps.ref(p, 'dst'),
          p.text('kind', 40),
          false,
        );
      case EdgeRemoveOp.NAME:
        return new EdgeRemoveOp(
          seq,
          baseVersion,
          ChangeOps.ref(p, 'src'),
          ChangeOps.ref(p, 'dst'),
          p.text('kind', 40),
        );
      case CategoryCreateOp.NAME:
        return new CategoryCreateOp(seq, null, {
          name: p.text('name', Category.NAME_MAX),
          color: p.optionalText('color', 40),
          description: p.optionalText('description', Category.DESCRIPTION_MAX),
          sort: p.optionalInteger('sort', 0, Category.SORT_MAX) ?? 0,
        });
      case CategoryAssignOp.NAME:
        return new CategoryAssignOp(seq, target(), baseVersion, ChangeOps.ref(p, 'category_id'));
      default:
        return null;
    }
  }

  /** 검토를 기다리던 변경을 되살린다. 저장한 payload는 처음 낼 때 검사했고, 판정 때 `@번호`도 실제 id로 바뀌었다 */
  static waiting(
    name: string,
    seq: number,
    targetId: string | null,
    baseVersion: number | null,
    payload: Readonly<Record<string, unknown>>,
  ): ChangeOp {
    const p = new RequestFields(payload);
    const op = ChangeOps.read(name, seq, targetId, baseVersion, p, p);
    p.throwIfInvalid();
    if (!op) throw new RuleViolation(`다시 적용할 수 없는 변경이에요: ${name}`);
    return op;
  }

  /** 점을 가리키는 칸: id나, 이 묶음의 앞 변경이 만든 것(`@번호`) */
  private static ref(p: RequestFields, name: string): string {
    const value = p.text(name, 40);
    if (ChangeOps.ID.test(value)) return value.toLowerCase();
    if (value && !ChangeOp.isMade(value)) p.reject(name, 'UUID나 @번호여야 해요');
    return value;
  }
}
