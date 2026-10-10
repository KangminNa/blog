import { createHash, randomBytes } from 'node:crypto';
import { Actor, BaseEntity, DomainEvent, InvalidRequest } from '../../platform';
import { OAuthError } from './oauth-error';

/** 기기의 토큰 하나. DB에는 해시만 두고, 원문은 만든 순간에만 있다 */
export class DeviceCredential {
  static readonly ACCESS = 'access';
  static readonly REFRESH = 'refresh';
  /** 예비 기기 토큰 (OAuth를 못 쓰는 도구용, 관리 화면에서 한 번만 보여줌) */
  static readonly DEVICE = 'device';

  private constructor(
    readonly kind: string,
    readonly hash: string,
    readonly expiresAt: Date | null,
    readonly revokedAt: Date | null,
    readonly token: string | null,
  ) {}

  static issue(kind: string, lifetimeMs: number | null, now: Date): DeviceCredential {
    const prefix = { access: 'cairn_at_', refresh: 'cairn_rt_', device: 'cairn_dt_' }[kind] ?? '';
    const token = `${prefix}${randomBytes(32).toString('base64url')}`;
    const expires = lifetimeMs === null ? null : new Date(now.getTime() + lifetimeMs);
    return new DeviceCredential(kind, DeviceCredential.hash(token), expires, null, token);
  }

  static restore(
    kind: string,
    hash: string,
    expiresAt: Date | null,
    revokedAt: Date | null,
  ): DeviceCredential {
    return new DeviceCredential(kind, hash, expiresAt, revokedAt, null);
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 화면에 보일 앞부분 (예: cairn_dt_AbC…) */
  get prefix(): string {
    return this.token ? `${this.token.slice(0, 14)}…` : '';
  }

  expiredAt(now: Date): boolean {
    return this.expiresAt !== null && this.expiresAt.getTime() <= now.getTime();
  }
}

// 연결된 기기 하나: AI 도구가 있는 컴퓨터. 토큰(OAuth access·refresh, 예비 기기 토큰)과 권한을 가진다.
// 기기는 지우지 않고 끊는다 (다른 모듈이 기기 id를 값으로 갖고 있으므로). 끊으면 모든 토큰이 바로 무효.
export class Device extends BaseEntity {
  static readonly ACCESS_MS = 60 * 60_000;
  static readonly REFRESH_MS = 30 * 86_400_000;
  /** 새 기기의 기본 권한: 올리기 + 공개 읽기 (2026-10-10 결정). 나머지는 관리 화면에서 켠다 */
  static readonly DEFAULT_SCOPES: readonly string[] = [Actor.UPLOAD, Actor.READ_PUBLIC];
  static readonly ALL_SCOPES: readonly string[] = [
    Actor.UPLOAD,
    Actor.READ_PUBLIC,
    Actor.READ_ALL,
    Actor.TIDY,
    Actor.WRITE,
  ];

  private readonly issued: DeviceCredential[] = [];
  private readonly retired: string[] = [];

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    readonly userId: string | null,
    private nameValue: string,
    private scopeList: string[],
    readonly clientId: string | null,
    readonly clientName: string,
    readonly createdAt: Date,
    private revoked: Date | null,
    /** 불러올 때 함께 읽은 토큰 하나 (갱신 토큰 확인용) */
    readonly presented: DeviceCredential | null,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  static connect(
    spaceId: string,
    userId: string,
    name: string,
    clientId: string,
    clientName: string,
    now: Date,
  ): Device {
    const device = new Device(
      BaseEntity.newId(),
      1,
      spaceId,
      userId,
      Device.checkName(name),
      [...Device.DEFAULT_SCOPES],
      clientId,
      clientName,
      now,
      null,
      null,
      true,
    );
    device.record(
      new DomainEvent('account.device.connected', 1, spaceId, {
        deviceId: device.id,
        name: device.name,
        client: clientName,
      }),
    );
    return device;
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    userId: string | null,
    name: string,
    scopes: readonly string[],
    clientId: string | null,
    clientName: string,
    createdAt: Date,
    revokedAt: Date | null,
    presented: DeviceCredential | null = null,
  ): Device {
    return new Device(
      id,
      version,
      spaceId,
      userId,
      name,
      [...scopes],
      clientId,
      clientName,
      createdAt,
      revokedAt,
      presented,
      false,
    );
  }

  get name(): string {
    return this.nameValue;
  }

  get scopes(): readonly string[] {
    return this.scopeList;
  }

  get revokedAt(): Date | null {
    return this.revoked;
  }

  /** 저장할 새 토큰들 */
  get newCredentials(): readonly DeviceCredential[] {
    return this.issued;
  }

  /** 무효로 할 토큰들 (해시) */
  get retiredHashes(): readonly string[] {
    return this.retired;
  }

  /** 방금 만든 토큰의 원문 (응답에 한 번만) */
  issuedToken(kind: string): DeviceCredential | null {
    return this.issued.find((c) => c.kind === kind) ?? null;
  }

  /** OAuth 토큰 한 쌍: access 1시간, refresh 30일 */
  issueTokens(now: Date): void {
    this.assertConnected();
    this.issued.push(
      DeviceCredential.issue(DeviceCredential.ACCESS, Device.ACCESS_MS, now),
      DeviceCredential.issue(DeviceCredential.REFRESH, Device.REFRESH_MS, now),
    );
  }

  /**
   * 내민 갱신 토큰이 이미 쓴(무효인) 것인가. 그렇다면 누군가 토큰을 훔쳐 먼저 썼을 수 있으므로
   * 부른 쪽이 이 기기를 끊는다 (OAuth 2.1 갱신 토큰 재사용 감지).
   */
  refreshWasReused(): boolean {
    return this.presented?.kind === DeviceCredential.REFRESH && this.presented.revokedAt !== null;
  }

  /** 갱신: 내민 갱신 토큰은 바로 무효로 하고 새 한 쌍을 준다 */
  refresh(now: Date): void {
    const presented = this.presented;
    if (!presented || presented.kind !== DeviceCredential.REFRESH || presented.expiredAt(now))
      throw new OAuthError('invalid_grant', '만료됐거나 맞지 않는 갱신 토큰이에요');
    this.retired.push(presented.hash);
    this.issueTokens(now);
  }

  /** 토큰 하나를 무효로 한다 (AI 도구가 로그아웃할 때, RFC 7009) */
  retire(tokenHash: string): void {
    this.retired.push(tokenHash);
  }

  issueDeviceToken(now: Date): void {
    this.assertConnected();
    this.issued.push(DeviceCredential.issue(DeviceCredential.DEVICE, null, now));
  }

  rename(name: string): void {
    this.nameValue = Device.checkName(name);
  }

  grant(scopes: readonly string[]): void {
    const unknown = scopes.filter((s) => !Device.ALL_SCOPES.includes(s));
    if (unknown.length > 0)
      throw new InvalidRequest(new Map([['scopes', `모르는 권한이에요: ${unknown.join(', ')}`]]));
    this.scopeList = Device.ALL_SCOPES.filter((s) => scopes.includes(s));
  }

  /** 끊는다. 모든 토큰이 바로 무효가 된다 */
  revoke(now: Date): void {
    if (this.revoked) return;
    this.revoked = now;
    this.record(
      new DomainEvent('account.device.revoked', 1, this.spaceId, {
        deviceId: this.id,
        name: this.name,
      }),
    );
  }

  private assertConnected(): void {
    if (this.revoked)
      throw new InvalidRequest(new Map([['device', '연결이 끊긴 기기예요. 다시 연결해 주세요']]));
  }

  private static checkName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 60)
      throw new InvalidRequest(new Map([['name', '1~60자로 넣어 주세요']]));
    return trimmed;
  }
}
