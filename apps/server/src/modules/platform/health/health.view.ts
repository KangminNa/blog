// 서버 상태의 읽기 모양.

/** 서버 상태 화면에 함께 보이는 묶음 */
export class HealthView {
  constructor(
    private readonly extensions: ReadonlyMap<string, string>,
    private readonly migrations: readonly string[],
    private readonly tablesBySchema: ReadonlyMap<string, number>,
  ) {}

  toJSON() {
    return {
      status: 'ok',
      extensions: Object.fromEntries(this.extensions),
      migrations: this.migrations,
      tables: Object.fromEntries(this.tablesBySchema),
    };
  }
}
