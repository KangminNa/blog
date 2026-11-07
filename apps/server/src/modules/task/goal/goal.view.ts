import type { GoalRow } from '../task.tables';

// 목표의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/** 목표 하나. 나무는 parentId로 화면이 잇는다 */
export class GoalView {
  constructor(
    private readonly row: Readonly<GoalRow>,
    /** 이어진 작업 중 끝나지 않은 것 (대기 · 실행 · 결재 대기). 목록에서만 센다 */
    private readonly openTasks = 0,
    /** 이어진 작업 중 끝난 것 */
    private readonly doneTasks = 0,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      parentId: r.parent_id,
      title: r.title,
      description: r.description,
      status: r.status,
      sort: r.sort,
      openTasks: this.openTasks,
      doneTasks: this.doneTasks,
      version: r.version,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 목표 전부 (순서 → 만든 순서). 몇십 개라 한 번에 보낸다 */
export class GoalListView {
  constructor(private readonly goals: readonly GoalView[]) {}

  toJSON() {
    return { goals: this.goals.map((g) => g.toJSON()), next: null };
  }
}
