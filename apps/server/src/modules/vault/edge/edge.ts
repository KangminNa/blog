import { BaseEntity, DomainEvent, RuleViolation } from '../../platform';
import { ChangeWork, TargetEntity } from '../change/change-target';
import type { EdgeNew, EdgeRow } from '../vault.tables';

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
export class Edge extends TargetEntity<EdgeRow, EdgeNew> {
  /** 사람이 지웠음을 나타내는 deleted_by_type (actor_type과 같은 값) */
  static readonly BY_HUMAN = 'user';

  readonly targetKind = 'edge';

  static open(work: ChangeWork, src: string, dst: string, kind: string): Edge {
    if (src === dst) throw new RuleViolation('점을 자기 자신과 이을 수 없어요');
    const edge = new Edge(
      {
        id: BaseEntity.newId(),
        space_id: work.spaceId,
        src,
        dst,
        kind,
        origin: work.origin,
        pinned: work.human,
        actor_type: work.actorType,
        actor_id: work.actorId,
        created_at: work.now,
        deleted_at: null,
        deleted_by_type: null,
      },
      true,
    );
    edge.announce();
    return edge;
  }

  static restore(row: EdgeRow): Edge {
    return new Edge(row);
  }

  get gone(): boolean {
    return this.row.deleted_at !== null;
  }

  /** 사람이 만들었거나 사람이 고정한 선인가 */
  get humanOwned(): boolean {
    return this.row.pinned || this.row.origin === ChangeWork.HUMAN;
  }

  /** 사람이 지운 선인가. 행이 남아 있어 AI가 다시 만들지 못한다 */
  get humanDeleted(): boolean {
    return this.gone && this.row.deleted_by_type === Edge.BY_HUMAN;
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
    const { origin, pinned, deleted_at, deleted_by_type } = this.row;
    return {
      version: this.version,
      origin,
      pinned,
      deleted_at: deleted_at?.toISOString() ?? null,
      deleted_by_type,
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
    this.put('deleted_at', at);
    this.put('deleted_by_type', by);
  }

  private setOwner(origin: string, pinned: boolean): void {
    this.put('origin', origin);
    this.put('pinned', pinned);
  }

  private announce(): void {
    const { src, dst, kind } = this.row;
    this.record(
      new DomainEvent('vault.edge.changed', 1, this.spaceId, {
        edgeId: this.id,
        src,
        dst,
        kind,
        deleted: this.gone,
      }),
    );
  }
}
