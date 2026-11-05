// 서버 상태의 읽기 모양. 웹이 `import type`으로 가져올 수 있게 아무것도 import하지 않는다 (객체설계 6장).

/** DB 연결, 확장, 적용된 마이그레이션, 모듈 스키마별 테이블 수 */
export class HealthView {
  constructor(
    readonly extensions: ReadonlyMap<string, string>,
    readonly migrations: readonly string[],
    readonly tablesBySchema: ReadonlyMap<string, number>,
  ) {}

  toJSON() {
    return {
      extensions: Object.fromEntries(this.extensions),
      migrations: [...this.migrations],
      tables: Object.fromEntries(this.tablesBySchema),
    };
  }
}
