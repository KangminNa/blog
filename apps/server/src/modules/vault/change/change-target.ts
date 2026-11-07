import { type Actor, TableEntity, type TableRow } from '../../platform';
import { SlugPolicy } from '../slug.policy';
import type { NodeRow } from '../vault.tables';

/** 변경 하나를 적용할 때의 맥락: 어느 묶음에서, 누가, 언제. 엔티티는 이것을 보고 판과 표시를 남긴다 */
export class ChangeWork {
  static readonly AI = 'ai';
  static readonly HUMAN = 'human';
  /** Actor 종류 → change_sets.actor_type */
  private static readonly ACTOR_TYPES: Readonly<Record<string, string>> = {
    owner: 'user',
    device: 'device',
    agent: 'ai',
    system: 'system',
  };

  constructor(
    readonly spaceId: string,
    readonly setId: string,
    readonly actorType: string,
    readonly actorId: string | null,
    readonly now: Date,
    /** 사람이 승인해서 적용하는가 (내용은 AI의 것이어도 사람이 지운 연결은 사람의 것으로 남긴다) */
    readonly approved: boolean,
  ) {}

  static actorTypeOf(actor: Actor): string {
    return ChangeWork.ACTOR_TYPES[actor.kind] ?? 'system';
  }

  /** 사람이 직접 한 변경인가. 사람이 만든 것은 AI가 덮지 못한다 */
  get human(): boolean {
    return this.actorType === 'user';
  }

  get origin(): string {
    return this.human ? ChangeWork.HUMAN : ChangeWork.AI;
  }
}

/** 변경 대상의 행이 공통으로 갖는 칸 */
export interface TargetRow extends TableRow {
  space_id: string;
}

/** vault.nodes에 행이 있는 표(세션 · wiki · 카테고리)를 읽은 모양. 열쇠가 node_id라 읽을 때 `node_id AS id`로 맞춘다 */
export interface NodeDetailRow extends TargetRow {
  node_id: string;
}

/** 휴지통으로 가는 점을 읽은 모양: 주소와 vault.nodes의 휴지통 표시까지 */
export interface GraphNodeRow extends NodeDetailRow {
  slug: string;
  deleted_at: Date | null;
}

/** 새 점의 행: 표의 New에 엔티티의 id를 더한다 (넣을 때는 뺀다) */
export type NewNode<N> = N & { id: string };

/**
 * 변경 묶음이 바꿀 수 있는 대상: 세션 · wiki · 카테고리 · 선. 지금 상태를 적어 두고(snapshot) 그 상태로 돌아갈 수 있다(rollBack).
 * 대상마다 행의 모양이 달라서 변경(ChangeOp)과 묶음은 이 약속으로만 대상을 다룬다.
 */
export interface ChangeTarget {
  readonly id: string;
  readonly version: number;
  /** change_ops.target_kind */
  readonly targetKind: string;
  /** 아직 저장하지 않은 새 대상인가 */
  readonly isNew: boolean;
  /** 지워져서 고칠 수 없는가 */
  readonly gone: boolean;
  /** 저장할 것이 있는가 */
  readonly changed: boolean;
  /** vault.changes의 before·after: 되돌릴 때 필요한 상태. 칸은 대상마다 다르고 JSON으로 저장된다 */
  snapshot(): Readonly<Record<string, unknown>>;
  /** before 상태로 돌아간다. before가 null이면 그 묶음이 만든 것이라 없앤다 */
  rollBack(before: Readonly<Record<string, unknown>> | null, work: ChangeWork): void;
}

// 변경 대상 중 표 한 줄을 엔티티 하나로 가진 것의 기반: 세션 · wiki · 카테고리 · 선.
export abstract class TargetEntity<R extends TargetRow, N extends TableRow = R>
  extends TableEntity<R, N>
  implements ChangeTarget
{
  abstract readonly targetKind: string;
  abstract get gone(): boolean;
  abstract snapshot(): Readonly<Record<string, unknown>>;
  abstract rollBack(before: Readonly<Record<string, unknown>> | null, work: ChangeWork): void;

  get changed(): boolean {
    return Object.keys(this.unsaved).length > 0;
  }

  get spaceId(): string {
    return this.row.space_id;
  }
}

// 그래프의 점 (vault.nodes에 행이 있는 대상 중 휴지통으로 가는 것): wiki · 카테고리.
// 휴지통 표시는 vault.nodes의 칸이라 표의 칸과 따로 들고 있다가 Repository가 점에 적는다.
export abstract class GraphNode<
  R extends GraphNodeRow,
  N extends TableRow = R,
> extends TargetEntity<R, N> {
  /** 휴지통 보관 기간 */
  private static readonly PURGE_MS = 30 * 24 * 60 * 60 * 1000;

  private deletedAt: Date | null;
  private purgeAfter: Date | null = null;
  private trashMoved = false;

  protected constructor(
    row: R | N,
    fresh: boolean,
    /** 사람이 정한 주소인가. 겹치면 번호를 붙이지 않고 거절한다 */
    private readonly manualSlug: boolean,
  ) {
    super(row, fresh);
    this.deletedAt = (row as Partial<GraphNodeRow>).deleted_at ?? null;
  }

  get gone(): boolean {
    return this.deletedAt !== null;
  }

  /** 지금 주소 (새 점이면 겹치지 않게 정하기 전의 주소) */
  get slug(): string {
    return this.row.slug;
  }

  /** 이번에 휴지통에 넣었거나 꺼냈으면 vault.nodes에 적을 칸 (Repository가 고친다). 아니면 null */
  get trashChange(): Pick<NodeRow, 'deleted_at' | 'purge_after'> | null {
    return this.trashMoved ? { deleted_at: this.deletedAt, purge_after: this.purgeAfter } : null;
  }

  override get changed(): boolean {
    return super.changed || this.trashMoved;
  }

  /** 저장이 끝난 뒤 Repository가 부른다 */
  trashSaved(): void {
    this.trashMoved = false;
  }

  /** 새 점의 주소를 정한다. taken: 이 주소이거나 "이 주소-숫자"인 같은 종류의 주소들 */
  settleSlug(taken: ReadonlySet<string>): void {
    this.put('slug', SlugPolicy.pick(this.row.slug, taken, this.manualSlug) as R['slug']);
  }

  protected moveToTrash(now: Date): void {
    if (this.gone) return;
    this.deletedAt = now;
    this.purgeAfter = new Date(now.getTime() + GraphNode.PURGE_MS);
    this.trashMoved = true;
  }

  protected takeOutOfTrash(): void {
    if (!this.gone) return;
    this.deletedAt = null;
    this.purgeAfter = null;
    this.trashMoved = true;
  }
}
