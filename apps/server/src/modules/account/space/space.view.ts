// 공간의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 블로그 정보 (누구나). version은 고칠 때 돌려보낸다 */
export class SpaceView {
  constructor(
    readonly name: string,
    readonly description: string,
    readonly siteUrl: string | null,
    readonly installed: boolean,
    readonly version: number,
    /** ChatGPT·Claude 앱 연결 허용 */
    readonly hostedApps: boolean,
  ) {}

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      siteUrl: this.siteUrl,
      installed: this.installed,
      version: this.version,
      hostedApps: this.hostedApps,
    };
  }
}

/** 설치 마법사가 다음 단계를 정할 때 보는 상태. 화면에는 다음 단계만 나간다 */
export class InstallStatusView {
  constructor(
    readonly installed: boolean,
    readonly spaceId: string | null,
    readonly passValid: boolean,
  ) {}

  /** 다음 단계: code(설치 코드) → owner(주인 계정) → done */
  toJSON() {
    const step: 'code' | 'owner' | 'done' = this.installed
      ? 'done'
      : this.passValid
        ? 'owner'
        : 'code';
    return { installed: this.installed, step };
  }
}
