// 세션 정리의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 자동 정리 설정. 행이 없으면 꺼짐이고 version은 0이다 */
export class TidySettingsView {
  constructor(
    readonly autoTidy: boolean,
    readonly version: number,
  ) {}

  toJSON() {
    return { autoTidy: this.autoTidy, version: this.version };
  }
}

/** 정리를 맡길 세션 하나 */
export class TidySessionView {
  constructor(
    readonly id: string,
    readonly title: string,
    /** 지금 판 번호. 일 요청의 requestId가 된다 */
    readonly seq: number,
    readonly version: number,
  ) {}
}

/** 대표 wiki가 없는 세션: 이번에 맡길 것과 전체 수 */
export class TidyBacklogPageView {
  constructor(
    readonly sessions: readonly TidySessionView[],
    readonly total: number,
  ) {}
}

/** 쌓인 세션 정리를 요청한 결과 */
export class TidyBacklogView {
  constructor(
    readonly requested: number,
    readonly remaining: number,
  ) {}

  toJSON() {
    return { requested: this.requested, remaining: this.remaining };
  }
}
