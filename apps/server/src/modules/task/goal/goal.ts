import { BaseEntity, RuleViolation, TrackedEntity } from '../../platform';

// 목표 하나 (task.goals). 목표는 나무다: 맨 위가 회사 목표이고, 작업은 목표 하나에 이어진다.
// 부모는 만들 때 정하고 바꾸지 않는다 (옮기면 순환을 따져야 하고, 이어진 작업의 맥락이 바뀐다).
// 지우지 않는다: 끝나면 done, 그만두면 dropped. 진행 중(active)인 목표에만 작업과 하위 목표를 더한다.
// 제목·설명·순서는 set으로, 상태는 changeStatus로만 바꾼다.
export class Goal extends TrackedEntity {
  static readonly ACTIVE = 'active';
  static readonly DONE = 'done';
  static readonly DROPPED = 'dropped';
  static readonly STATUSES: readonly string[] = [Goal.ACTIVE, Goal.DONE, Goal.DROPPED];
  static readonly TITLE_MAX = 200;
  static readonly DESCRIPTION_MAX = 4000;
  /** 회사 목표부터 이만큼 아래까지 (회사 › 영역 › 분기 › 달 › 주) */
  static readonly DEPTH_MAX = 5;

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    readonly parentId: string | null,
    private titleValue: string,
    private descriptionValue: string,
    private statusValue: string,
    private sortValue: number,
    readonly createdAt: Date,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  /**
   * 새 목표. parent가 없으면 맨 위 목표다. parentDepth는 부모가 몇 단계에 있는지 (맨 위가 1)
   */
  static open(
    spaceId: string,
    parent: Goal | null,
    parentDepth: number,
    title: string,
    description: string,
    sort: number,
    now: Date,
  ): Goal {
    if (parent) {
      parent.assertActive();
      if (parentDepth + 1 > Goal.DEPTH_MAX)
        throw new RuleViolation(`목표는 ${Goal.DEPTH_MAX}단계까지예요`);
    }
    const goal = new Goal(
      BaseEntity.newId(),
      1,
      spaceId,
      parent?.id ?? null,
      '',
      '',
      Goal.ACTIVE,
      0,
      now,
      true,
    );
    goal.title = title;
    goal.description = description;
    goal.sort = sort;
    return goal;
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    parentId: string | null,
    title: string,
    description: string,
    status: string,
    sort: number,
    createdAt: Date,
  ): Goal {
    return new Goal(
      id,
      version,
      spaceId,
      parentId,
      title,
      description,
      status,
      sort,
      createdAt,
      false,
    );
  }

  get title(): string {
    return this.titleValue;
  }

  set title(value: string) {
    const title = value.trim();
    if (title.length < 1 || title.length > Goal.TITLE_MAX)
      throw new RuleViolation(`제목은 1~${Goal.TITLE_MAX}자예요`);
    this.titleValue = title;
    this.track('title', title);
  }

  get description(): string {
    return this.descriptionValue;
  }

  set description(value: string) {
    if (value.length > Goal.DESCRIPTION_MAX)
      throw new RuleViolation(`설명은 ${Goal.DESCRIPTION_MAX}자까지예요`);
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

  get status(): string {
    return this.statusValue;
  }

  get active(): boolean {
    return this.statusValue === Goal.ACTIVE;
  }

  /** 진행 중 · 끝남 · 그만둠 사이는 어느 쪽으로든 바꿀 수 있다 (다시 열기 포함). 같으면 그대로 */
  changeStatus(status: string): void {
    if (!Goal.STATUSES.includes(status))
      throw new RuleViolation(`목표 상태는 ${Goal.STATUSES.join(' · ')} 중 하나예요`);
    if (status === this.statusValue) return;
    this.statusValue = status;
    this.track('status', status);
  }

  /** 작업이나 하위 목표를 더할 수 있는가: 진행 중인 목표에만 */
  assertActive(): void {
    if (!this.active) throw new RuleViolation(`진행 중인 목표가 아니에요: ${this.titleValue}`);
  }
}
