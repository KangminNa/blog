import type { SpaceRow } from '../account.tables';

// 공간의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 이름만 spaces의 칸이고, 소개 · 사이트 주소 · 앱 연결 허용은 settings 표의 값이다 (키 하나에 행 하나).
// 설정 표에는 다른 값도 있을 수 있어 내보낼 값을 키로 하나씩 고른다.

/** 공간 한 줄과 함께 읽은 설정들 (키 → 값) */
export type LoadedSpace = SpaceRow & { settings: Readonly<Record<string, unknown>> | null };

/** 블로그 정보 (누구나). version은 고칠 때 돌려보낸다 */
export class SpaceView {
  static readonly DESCRIPTION = 'blog.description';
  static readonly SITE_URL = 'site.url';
  static readonly HOSTED_APPS = 'connect.hosted_apps';

  constructor(
    private readonly row: Readonly<LoadedSpace> | null,
    /** 주인이 있다 = 설치가 끝났다 */
    private readonly installed: boolean,
  ) {}

  get description(): string {
    return this.text(SpaceView.DESCRIPTION) ?? '';
  }

  get siteUrl(): string | null {
    return this.text(SpaceView.SITE_URL);
  }

  /**
   * ChatGPT·Claude 앱(웹·데스크톱 채팅)의 연결을 받는가. 기본은 꺼짐.
   * 이 앱들은 로그인 열쇠를 chatgpt.com·claude.ai로 돌려받아서, 남이 시작한 연결을 승인하면 그 사람 계정이 붙는다.
   * 그래서 쓰는 사람만 켜고, 켜도 승인 화면이 앱 연결임을 알린다.
   */
  get hostedApps(): boolean {
    return this.row?.settings?.[SpaceView.HOSTED_APPS] === true;
  }

  /** 로고 주소. 내용이 바뀌면 주소도 바뀌어(v) 브라우저가 옛 그림을 들고 있지 않는다 */
  get logoUrl(): string | null {
    const hash = this.row?.logo_blob_hash;
    return hash ? `/api/space/logo?v=${hash.slice(0, 12)}` : null;
  }

  toJSON() {
    return {
      name: this.row?.name ?? '',
      description: this.description,
      siteUrl: this.siteUrl,
      installed: this.installed,
      version: this.row?.version ?? 0,
      hostedApps: this.hostedApps,
      logoUrl: this.logoUrl,
    };
  }

  private text(key: string): string | null {
    const value = this.row?.settings?.[key];
    return typeof value === 'string' ? value : null;
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

/** 설치 코드가 맞음. 통행증은 쿠키로만 나간다 */
export class InstallPassView {
  constructor(private readonly seconds: number) {}

  toJSON() {
    return { verified: true, expiresIn: this.seconds };
  }
}
