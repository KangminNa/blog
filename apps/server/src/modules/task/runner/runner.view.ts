// 러너의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).
// 이름·종류(서버 러너인지)는 기기 목록(api/devices)에 있고, 화면이 deviceId로 합친다.

/** 러너가 지금 하는 일 */
export class RunnerTaskView {
  constructor(
    readonly id: string,
    readonly title: string,
  ) {}

  toJSON() {
    return { id: this.id, title: this.title };
  }
}

/** 러너 하나 */
export class RunnerView {
  constructor(
    readonly id: string,
    readonly deviceId: string,
    /** 일 받기 */
    readonly accepting: boolean,
    /** 마지막으로 닿은 지 90초 안 */
    readonly online: boolean,
    readonly lastSeenAt: Date,
    readonly task: RunnerTaskView | null,
    readonly version: number,
  ) {}

  toJSON() {
    return {
      id: this.id,
      deviceId: this.deviceId,
      accepting: this.accepting,
      online: this.online,
      lastSeenAt: this.lastSeenAt.toISOString(),
      task: this.task?.toJSON() ?? null,
      version: this.version,
    };
  }
}

/** 러너 목록. 몇 개뿐이라 한 번에 보낸다 */
export class RunnerListView {
  constructor(readonly runners: readonly RunnerView[]) {}

  toJSON() {
    return { runners: this.runners.map((r) => r.toJSON()), next: null };
  }
}
