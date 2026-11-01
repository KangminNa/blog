import { type Actor, TrackedEntity } from '../../platform';

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

// 변경 묶음이 바꿀 수 있는 대상: 세션 · wiki · 카테고리 · 선. 지금 상태를 적어 두고(snapshot) 그 상태로 돌아갈 수 있다(rollBack).
export abstract class ChangeTarget extends TrackedEntity {
  /** change_ops.target_kind */
  abstract readonly targetKind: string;
  private fresh: boolean;

  protected constructor(id: string, version: number, isNew: boolean) {
    super(id, version);
    this.fresh = isNew;
  }

  /** 아직 저장하지 않은 새 대상인가 */
  get isNew(): boolean {
    return this.fresh;
  }

  /** 처음 저장이 끝난 뒤 Repository가 부른다 */
  markInserted(): void {
    this.fresh = false;
  }

  /** 지워져서 고칠 수 없는가 */
  abstract get gone(): boolean;

  /** vault.changes의 before·after: 되돌릴 때 필요한 상태. 칸은 대상마다 다르고 JSON으로 저장된다 */
  abstract snapshot(): Readonly<Record<string, unknown>>;

  /** before 상태로 돌아간다. before가 null이면 그 묶음이 만든 것이라 없앤다 */
  abstract rollBack(before: Readonly<Record<string, unknown>> | null, work: ChangeWork): void;
}

// 그래프의 점 (vault.nodes에 행이 있는 대상 중 휴지통으로 가는 것): wiki · 카테고리.
export abstract class GraphNode extends ChangeTarget {
  /** 휴지통 보관 기간 */
  private static readonly PURGE_MS = 30 * 24 * 60 * 60 * 1000;

  private deletedAtValue: Date | null;
  private purgeAfterValue: Date | null = null;
  private trashMoved = false;

  protected constructor(id: string, version: number, isNew: boolean, deletedAt: Date | null) {
    super(id, version, isNew);
    this.deletedAtValue = deletedAt;
  }

  get gone(): boolean {
    return this.deletedAtValue !== null;
  }

  get deletedAt(): Date | null {
    return this.deletedAtValue;
  }

  get purgeAfter(): Date | null {
    return this.purgeAfterValue;
  }

  /** 이번에 휴지통에 넣었거나 꺼냈는가 (Repository가 vault.nodes를 고친다) */
  get trashChanged(): boolean {
    return this.trashMoved;
  }

  override get changed(): boolean {
    return super.changed || this.trashMoved;
  }

  /** 저장이 끝난 뒤 Repository가 부른다 */
  trashSaved(): void {
    this.trashMoved = false;
  }

  protected moveToTrash(now: Date): void {
    if (this.gone) return;
    this.deletedAtValue = now;
    this.purgeAfterValue = new Date(now.getTime() + GraphNode.PURGE_MS);
    this.trashMoved = true;
  }

  protected takeOutOfTrash(): void {
    if (!this.gone) return;
    this.deletedAtValue = null;
    this.purgeAfterValue = null;
    this.trashMoved = true;
  }
}
