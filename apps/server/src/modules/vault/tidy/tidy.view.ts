import type { TidySettingRow } from '../vault.tables';

// 세션 정리의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).

/** 자동 정리 설정. 행이 없으면 꺼짐이고 version은 0이다 */
export class TidySettingsView {
  constructor(private readonly row: Readonly<Pick<TidySettingRow, 'auto_tidy' | 'version'>>) {}

  toJSON() {
    return { autoTidy: this.row.auto_tidy, version: this.row.version };
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
