import { Forbidden } from './errors';

// 요청한 주체. Guard가 만들고, Service는 첫 줄에서 권한을 묻고, Query는 공개 범위를 거를 때 쓴다.
// 모듈 경계를 넘을 수 있도록 값으로만 이루어진다 (서버를 나누면 그대로 토큰 내용이 된다).
export abstract class Actor {
  static readonly UPLOAD = 'upload';
  static readonly READ_PUBLIC = 'read_public';
  static readonly READ_ALL = 'read_all';
  static readonly TIDY = 'tidy';
  static readonly WRITE = 'write';

  abstract readonly kind: string;

  constructor(
    readonly spaceId: string | null,
    readonly id: string | null,
  ) {}

  abstract can(scope: string): boolean;

  assertCan(scope: string): void {
    if (!this.can(scope)) throw new Forbidden(scope);
  }

  /** 비공개 데이터까지 볼 수 있는가 */
  canSeePrivate(): boolean {
    return this.can(Actor.READ_ALL);
  }

  toJSON(): object {
    return { kind: this.kind, spaceId: this.spaceId, id: this.id };
  }
}

/** 블로그 주인 (관리 모드) */
export class OwnerActor extends Actor {
  readonly kind = 'owner';

  constructor(spaceId: string, userId: string) {
    super(spaceId, userId);
  }

  can(): boolean {
    return true;
  }
}

/** 연결된 기기의 AI 도구 (MCP). 기기에 준 권한만 */
export class DeviceActor extends Actor {
  readonly kind = 'device';

  constructor(
    spaceId: string,
    deviceId: string,
    private readonly scopes: ReadonlySet<string>,
  ) {
    super(spaceId, deviceId);
  }

  can(scope: string): boolean {
    return this.scopes.has(scope);
  }

  override toJSON(): object {
    return { ...super.toJSON(), scopes: [...this.scopes] };
  }
}

/** 로그인하지 않은 방문자. 공개된 것만 */
export class VisitorActor extends Actor {
  readonly kind = 'visitor';

  constructor() {
    super(null, null);
  }

  can(): boolean {
    return false;
  }
}

/** 일꾼·예약 작업처럼 사람이 아닌 서버 자신. 목록 파일에서 허락받은 일만 이 자격으로 한다 */
export class SystemActor extends Actor {
  readonly kind = 'system';

  constructor() {
    super(null, null);
  }

  can(): boolean {
    return true;
  }
}
