// 서버 상태의 읽기 모양. 웹이 `import type`으로 가져올 수 있게 아무것도 import하지 않는다 (객체설계 6장).

/** 누구나: 서버와 DB가 살아 있다. 운영의 상태 확인은 응답 코드만 본다 (docker-compose.prod.yml) */
export class HealthView {
  toJSON() {
    return { status: 'ok' };
  }
}

/**
 * 주인과 서버 자신: DB 확장, 적용된 마이그레이션, 모듈 스키마별 테이블 수.
 * 버전을 짐작할 단서라 방문자에게는 주지 않는다
 */
export class HealthDetailView extends HealthView {
  constructor(
    private readonly extensions: ReadonlyMap<string, string>,
    private readonly migrations: readonly string[],
    private readonly tablesBySchema: ReadonlyMap<string, number>,
  ) {
    super();
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      extensions: Object.fromEntries(this.extensions),
      migrations: [...this.migrations],
      tables: Object.fromEntries(this.tablesBySchema),
    };
  }
}
