import { BaseEntity, DomainEvent, RuleViolation } from '../../platform';
import { ChangeTarget, type ChangeWork } from '../change/change-target';

/** 연결 종류 하나 (vault.edge_kinds). 방향 없는 종류는 (작은 id, 큰 id)로 저장한다 */
export class EdgeKind {
  constructor(
    readonly name: string,
    readonly directed: boolean,
    readonly aiCreatable: boolean,
  ) {}

  /** 저장할 때의 양 끝 */
  ends(src: string, dst: string): readonly [string, string] {
    return this.directed || src < dst ? [src, dst] : [dst, src];
  }
}

// 연결선 (재료 · 링크 · 비슷함). 지워도 행을 남긴다: 사람이 지운 선은 AI가 다시 만들지 못한다.
// 사람이 만든 선(pinned)은 AI가 지우려 하면 검토로 간다.
export class Edge extends ChangeTarget {
  /** 사람이 지웠음을 나타내는 deleted_by_type (actor_type과 같은 값) */
  static readonly BY_HUMAN = 'user';

  readonly targetKind = 'edge';

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    readonly src: string,
    readonly dst: string,
    readonly kind: string,
    private originValue: string,
    private pinnedValue: boolean,
    readonly actorType: string | null,
    readonly actorId: string | null,
    readonly createdAt: Date,
    private deletedAtValue: Date | null,
    private deletedByValue: string | null,
    isNew: boolean,
  ) {
    super(id, version, isNew);
  }

  static open(work: ChangeWork, src: string, dst: string, kind: string): Edge {
    if (src === dst) throw new RuleViolation('점을 자기 자신과 이을 수 없어요');
    const edge = new Edge(
      BaseEntity.newId(),
      1,
      work.spaceId,
      src,
      dst,
      kind,
      work.origin,
      work.human,
      work.actorType,
      work.actorId,
      work.now,
      null,
      null,
      true,
    );
    edge.announce();
    return edge;
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    src: string,
    dst: string,
    kind: string,
    origin: string,
    pinned: boolean,
    actorType: string | null,
    actorId: string | null,
    createdAt: Date,
    deletedAt: Date | null,
    deletedByType: string | null,
  ): Edge {
    return new Edge(
      id,
      version,
      spaceId,
      src,
      dst,
      kind,
      origin,
      pinned,
      actorType,
      actorId,
      createdAt,
      deletedAt,
      deletedByType,
      false,
    );
  }

  get origin(): string {
    return this.originValue;
  }

  get pinned(): boolean {
    return this.pinnedValue;
  }

  get deletedAt(): Date | null {
    return this.deletedAtValue;
  }

  get deletedBy(): string | null {
    return this.deletedByValue;
  }

  get gone(): boolean {
    return this.deletedAtValue !== null;
  }

  /** 사람이 만들었거나 사람이 고정한 선인가 */
  get humanOwned(): boolean {
    return this.pinnedValue || this.originValue === 'human';
  }

  /** 사람이 지운 선인가. 행이 남아 있어 AI가 다시 만들지 못한다 */
  get humanDeleted(): boolean {
    return this.gone && this.deletedByValue === Edge.BY_HUMAN;
  }

  /** 지운다. 사람이 지웠거나 승인했으면 사람이 지운 선으로 남는다 */
  remove(work: ChangeWork): void {
    if (this.gone) return;
    this.setDeleted(work.now, work.approved ? Edge.BY_HUMAN : work.actorType);
    this.announce();
  }

  /** 지운 선을 다시 산 선으로. 만든 쪽 표시도 새로 한다 */
  revive(work: ChangeWork): void {
    if (!this.gone) return;
    this.setDeleted(null, null);
    this.setOwner(work.origin, work.human);
    this.announce();
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return {
      version: this.version,
      origin: this.originValue,
      pinned: this.pinnedValue,
      deleted_at: this.deletedAtValue?.toISOString() ?? null,
      deleted_by_type: this.deletedByValue,
    };
  }

  /** 앞 상태로 돌아간다. 이 묶음이 만든 선이면 지운다: 사람이 되돌렸으므로 AI가 다시 만들지 못한다 */
  rollBack(before: Readonly<Record<string, unknown>> | null, work: ChangeWork): void {
    if (before === null) {
      this.setDeleted(work.now, work.actorType);
    } else {
      const at = before.deleted_at === null ? null : new Date(String(before.deleted_at));
      this.setDeleted(at, before.deleted_by_type === null ? null : String(before.deleted_by_type));
      this.setOwner(String(before.origin), Boolean(before.pinned));
    }
    this.announce();
  }

  private setDeleted(at: Date | null, by: string | null): void {
    this.deletedAtValue = at;
    this.deletedByValue = by;
    this.track('deleted_at', at);
    this.track('deleted_by_type', by);
  }

  private setOwner(origin: string, pinned: boolean): void {
    this.originValue = origin;
    this.pinnedValue = pinned;
    this.track('origin', origin);
    this.track('pinned', pinned);
  }

  private announce(): void {
    this.record(
      new DomainEvent('vault.edge.changed', 1, this.spaceId, {
        edgeId: this.id,
        src: this.src,
        dst: this.dst,
        kind: this.kind,
        deleted: this.gone,
      }),
    );
  }
}
