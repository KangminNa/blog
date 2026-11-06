// 목표의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 목표 하나. 나무는 parentId로 화면이 잇는다 */
export class GoalView {
  constructor(
    readonly id: string,
    readonly parentId: string | null,
    readonly title: string,
    readonly description: string,
    readonly status: string,
    readonly sort: number,
    /** 이어진 작업 중 끝나지 않은 것 (대기 · 실행 · 결재 대기). 목록에서만 채운다 */
    readonly openTasks: number,
    /** 이어진 작업 중 끝난 것 */
    readonly doneTasks: number,
    readonly version: number,
    readonly createdAt: Date,
  ) {}

  toJSON() {
    return {
      id: this.id,
      parentId: this.parentId,
      title: this.title,
      description: this.description,
      status: this.status,
      sort: this.sort,
      openTasks: this.openTasks,
      doneTasks: this.doneTasks,
      version: this.version,
      createdAt: this.createdAt.toISOString(),
    };
  }
}

/** 목표 전부 (순서 → 만든 순서). 몇십 개라 한 번에 보낸다 */
export class GoalListView {
  constructor(readonly goals: readonly GoalView[]) {}

  toJSON() {
    return { goals: this.goals.map((g) => g.toJSON()), next: null };
  }
}
