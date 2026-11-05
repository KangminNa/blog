// 기기의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 기기 하나 (관리 화면의 기기 화면) */
export class DeviceView {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly clientName: string,
    readonly scopes: readonly string[],
    readonly createdAt: Date,
    readonly lastUsedAt: Date | null,
    readonly revokedAt: Date | null,
    readonly version: number,
  ) {}

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      client: this.clientName,
      scopes: [...this.scopes],
      createdAt: this.createdAt.toISOString(),
      lastUsedAt: this.lastUsedAt?.toISOString() ?? null,
      revokedAt: this.revokedAt?.toISOString() ?? null,
      version: this.version,
    };
  }
}

/** 승인 화면에 보일 것 */
export class ConsentView {
  constructor(
    readonly clientName: string,
    readonly redirectHost: string,
    readonly name: string,
    readonly scopes: readonly string[],
    /** ChatGPT·Claude 앱의 연결이면 그 앱 이름 (승인 화면이 직접 시작한 연결인지 묻는다) */
    readonly app: string | null,
  ) {}

  toJSON() {
    return {
      clientName: this.clientName,
      redirectHost: this.redirectHost,
      name: this.name,
      scopes: [...this.scopes],
      app: this.app,
    };
  }
}

/** OAuth 안내 문서(메타데이터)를 만들 때 쓰는 주소들 */
export class OAuthAddressView {
  constructor(readonly siteUrl: string) {}

  get issuer(): string {
    return this.siteUrl;
  }

  get resource(): string {
    return `${this.siteUrl}/mcp`;
  }
}
