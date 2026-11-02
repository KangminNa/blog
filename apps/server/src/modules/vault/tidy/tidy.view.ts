import type { SessionRow, TidySettingRow } from '../vault.tables';

// 세션 정리의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/** 자동 정리 설정. 행이 없으면 꺼짐이고 version은 0이다 */
export class TidySettingsView {
  constructor(private readonly row: Readonly<Pick<TidySettingRow, 'auto_tidy' | 'version'>>) {}

  toJSON() {
    return { autoTidy: this.row.auto_tidy, version: this.row.version };
  }
}

/** 정리를 맡길 세션을 읽는 칸 */
export type TidySessionRow = Pick<
  SessionRow,
  'node_id' | 'head_title' | 'revision_count' | 'version'
>;

/** 정리를 맡길 세션 하나 */
export class TidySessionView {
  constructor(private readonly row: Readonly<TidySessionRow>) {}

  get id(): string {
    return this.row.node_id;
  }

  get title(): string {
    return this.row.head_title ?? '';
  }

  /** 지금 판 번호. 일 요청의 requestId가 된다 */
  get seq(): number {
    return this.row.revision_count;
  }

  get version(): number {
    return this.row.version;
  }
}

/** 쌓인 세션 정리를 요청한 결과 */
export class TidyBacklogView {
  constructor(
    private readonly requested: number,
    private readonly remaining: number,
  ) {}

  toJSON() {
    return { requested: this.requested, remaining: this.remaining };
  }
}
