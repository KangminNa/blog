import { createHash, randomBytes } from 'node:crypto';
import {
  Actor,
  BaseEntity,
  type ColumnRules,
  Conflict,
  DomainEvent,
  InvalidRequest,
  RuleViolation,
  TableEntity,
} from '../../platform';
import type { DeviceNew, DeviceRow, DeviceTokenNew, OauthTokenNew } from '../account.tables';
import { DeviceSavedView, TokenView } from './device.view';
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
// 주인이 정하는 칸(이름·권한)은 RULES를 지나서만 바뀌고, 토큰과 끊기는 메서드로만 바뀐다.
export class Device extends TableEntity<DeviceRow, DeviceNew> {
  static readonly ACCESS_MS = 60 * 60_000;
  static readonly REFRESH_MS = 30 * 86_400_000;
  /** 새 기기의 기본 권한: 올리기 + 공개 읽기. 나머지는 관리 화면에서 켠다 */
  static readonly DEFAULT_SCOPES: readonly string[] = [Actor.UPLOAD, Actor.READ_PUBLIC];
  /**
   * 소식 기기의 권한 (2차 1-3): 앱이 승인 요청에 scope=news를 실어 만든다 (cairn connect의 훅 · 상태 줄).
   * 다른 권한과 함께 두지 않아 관리자가 주거나 바꾸지 못한다 (ALL_SCOPES에 없음, DB CHECK devices_news_only)
   */
  static readonly NEWS_SCOPES: readonly string[] = [Actor.NEWS];
  static readonly ALL_SCOPES: readonly string[] = [
    Actor.UPLOAD,
    Actor.READ_PUBLIC,
    Actor.READ_ALL,
    Actor.TIDY,
    Actor.WRITE,
    Actor.RUN,
    Actor.DELEGATE,
  ];

  /** 러너의 도구 이름 (기기 목록에 보인다) */
  private static readonly RUNNER_CLIENT = '러너';
  /** 배포 서버 안의 러너: 이름과 도구 이름. 공간마다 살아 있는 것은 하나 (살아 있는 기기 이름의 유일 인덱스) */
  static readonly SERVER_RUNNER = '서버 러너';
  /**
   * 코드 러너 칸 (docs/코드작업.md): 도구 이름. 기기 이름은 "코드 러너 <칸>"이고 칸마다 살아 있는 것은 하나.
   * 권한은 run · sandbox로 정해져 있고 주인이 바꾸지 못한다 (sandbox는 이 기기만 가진다, DB CHECK devices_sandbox_only)
   */
  static readonly CODE_RUNNER = '코드 러너';
  private static readonly CODE_RUNNER_SCOPES: readonly string[] = [Actor.RUN, Actor.SANDBOX];

  /** 주인이 정하는 칸과 그 규칙. 권한은 정해진 순서로 둔다 */
  private static readonly RULES: ColumnRules<DeviceRow> = {
    name: (value) => Device.checkName(value),
    scopes: (value) => {
      const unknown = value.filter((s) => !Device.ALL_SCOPES.includes(s));
      if (unknown.length > 0)
        throw new InvalidRequest(new Map([['scopes', `모르는 권한이에요: ${unknown.join(', ')}`]]));
      return Device.ALL_SCOPES.filter((s) => value.includes(s));
    },
  };

  private readonly issued: DeviceCredential[] = [];
  private readonly retired: string[] = [];
  private retireDeviceTokens = false;

  private constructor(
    row: DeviceRow | DeviceNew,
    /** 불러올 때 함께 읽은 토큰 하나 (갱신 토큰 확인용) */
    private readonly presented: DeviceCredential | null,
    fresh = false,
  ) {
    super(row, fresh);
  }

  /**
   * OAuth로 연결한 기기: 주인이 승인 화면에서 정한 이름과 기본 권한.
   * 앱이 소식 권한을 요청해 승인됐으면(requested: [news]) 그 권한만 갖는 소식 기기
   */
  static connect(
    spaceId: string,
    userId: string,
    name: string,
    clientId: string,
    clientName: string,
    now: Date,
    requested: readonly string[] | null = null,
  ): Device {
    const news = requested?.length === 1 && requested[0] === Actor.NEWS;
    const scopes = news ? Device.NEWS_SCOPES : Device.DEFAULT_SCOPES;
    return Device.open(spaceId, userId, name, scopes, clientId, clientName, now);
  }

  /** 러너: OAuth 없이 콘솔에서 만든다. 일을 빌리는 권한만 갖고, 토큰은 만들 때 한 번만 보인다 */
  static forRunner(spaceId: string, userId: string, name: string, now: Date): Device {
    const device = Device.open(spaceId, userId, name, [Actor.RUN], null, Device.RUNNER_CLIENT, now);
    device.issueDeviceToken(now);
    return device;
  }

  /**
   * 서버 러너: 배포 서버의 러너 컨테이너가 연결 값으로 스스로 연결한다 (ServerRunnerPolicy).
   * 사람이 승인하지 않아서 주인(user)이 없고, 일을 빌리는 권한만 갖는다
   */
  static forServerRunner(spaceId: string, now: Date): Device {
    const name = Device.SERVER_RUNNER;
    const device = Device.open(spaceId, null, name, [Actor.RUN], null, name, now);
    device.issueDeviceToken(now);
    return device;
  }

  /** 코드 러너 칸 하나: 서버 러너처럼 연결 값으로 스스로 연결한다. 주인이 없고 셸 있는 일을 빌리는 권한만 갖는다 */
  static forCodeRunner(spaceId: string, slot: string, now: Date): Device {
    const device = Device.open(
      spaceId,
      null,
      Device.codeRunnerName(slot),
      Device.CODE_RUNNER_SCOPES,
      null,
      Device.CODE_RUNNER,
      now,
    );
    device.issueDeviceToken(now);
    return device;
  }

  /** 칸의 기기 이름 */
  static codeRunnerName(slot: string): string {
    return `${Device.CODE_RUNNER} ${slot}`;
  }

  /** presented: 갱신 토큰으로 찾았을 때 그 토큰 */
  static restore(row: DeviceRow, presented: DeviceCredential | null = null): Device {
    return new Device(row, presented);
  }

  private static open(
    spaceId: string,
    userId: string | null,
    name: string,
    scopes: readonly string[],
    clientId: string | null,
    clientName: string,
    now: Date,
  ): Device {
    const device = new Device(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        user_id: userId,
        name: Device.checkName(name),
        scopes: [...scopes],
        meta: { clientId, clientName },
        created_at: now,
      },
      null,
      true,
    );
    device.record(
      new DomainEvent('account.device.connected', 1, spaceId, {
        deviceId: device.id,
        name: device.row.name,
        client: clientName,
      }),
    );
    return device;
  }

  /** 이 기기를 연결한 OAuth 클라이언트. 갱신할 때 같은 클라이언트인지 본다 */
  get clientId(): string | null {
    return (this.meta.clientId as string | null | undefined) ?? null;
  }

  get revoked(): boolean {
    return Boolean(this.row.revoked_at);
  }

  /** 서버 러너인가 (같은 이름을 쓰는 다른 기기가 아니라) */
  get isServerRunner(): boolean {
    return this.meta.clientName === Device.SERVER_RUNNER;
  }

  /** 코드 러너 칸인가 (같은 이름을 쓰는 다른 기기가 아니라) */
  get isCodeRunner(): boolean {
    return this.meta.clientName === Device.CODE_RUNNER;
  }

  /** 소식 기기인가 (권한이 news 하나) */
  get isNews(): boolean {
    return this.row.scopes.includes(Actor.NEWS);
  }

  /** 칸이 그대로여도 저장하면 version이 오른다: 토큰만 바뀌어도 화면이 든 기기는 옛것이 된다 */
  override get unsaved(): Partial<DeviceRow> {
    const changed = super.unsaved;
    return Object.keys(changed).length > 0 ? changed : { name: this.row.name };
  }

  /** 저장할 새 OAuth 토큰들. 해시만 들어간다 (id는 DB가 정한다) */
  get newOAuthTokens(): readonly Omit<OauthTokenNew, 'id'>[] {
    return this.issued
      .filter((c) => c.kind !== DeviceCredential.DEVICE)
      .map((c) => ({
        device_id: this.id,
        client_id: this.clientId,
        kind: c.kind,
        token_hash: c.hash,
        scopes: this.row.scopes,
        expires_at: c.expiresAt as Date,
      }));
  }

  /** 저장할 새 예비 기기 토큰들. 해시와 화면에 보일 앞부분만 들어간다 (id는 DB가 정한다) */
  get newDeviceTokens(): readonly Omit<DeviceTokenNew, 'id'>[] {
    return this.issued
      .filter((c) => c.kind === DeviceCredential.DEVICE)
      .map((c) => ({
        device_id: this.id,
        token_hash: c.hash,
        prefix: c.prefix,
        expires_at: c.expiresAt,
      }));
  }

  /** 무효로 할 토큰들 (해시) */
  get retiredHashes(): readonly string[] {
    return this.retired;
  }

  /** 저장할 때 이 기기의 기기 토큰을 모두 무효로 하는가 (새 토큰을 넣기 전에) */
  get retiresDeviceTokens(): boolean {
    return this.retireDeviceTokens;
  }

  /** 주인이 고친 칸 (이름·권한) */
  edit(changes: Partial<DeviceRow>): void {
    // 칸은 이름으로 다시 찾고(연결할 때), 권한은 칸에 맞춰 정해져 있다. 바꾸면 칸이 새 기기를 만들어 쌓인다
    if (this.isCodeRunner && (changes.name !== undefined || changes.scopes !== undefined))
      throw new RuleViolation('코드 러너 칸의 이름 · 권한은 바꿀 수 없어요');
    // 소식 기기는 소식만 읽는다: 다른 권한을 더하면 훅 · 상태 줄의 토큰이 그만큼 넓어진다
    if (this.isNews && changes.scopes !== undefined)
      throw new RuleViolation('소식 기기의 권한은 바꿀 수 없어요');
    this.accept(changes, Device.RULES);
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

  /** 기기 토큰을 새로 바꾼다: 지금까지의 기기 토큰은 모두 무효, 새 토큰 하나 (서버 러너가 다시 연결할 때) */
  rotateDeviceToken(now: Date): void {
    this.retireDeviceTokens = true;
    this.issueDeviceToken(now);
  }

  /** 끊는다. 모든 토큰이 바로 무효가 된다 */
  revoke(now: Date): void {
    if (this.revoked) return;
    this.put('revoked_at', now);
    this.record(
      new DomainEvent('account.device.revoked', 1, this.row.space_id, {
        deviceId: this.id,
        name: this.row.name,
      }),
    );
  }

  /** 끊지 않은 기기끼리 이름이 겹쳤을 때 (DB의 유일 인덱스). Repository가 던진다 */
  nameTaken(): Conflict {
    return new Conflict(`이미 쓰는 기기 이름이에요: ${this.row.name}. 다른 이름을 써 주세요`);
  }

  /** 바꾼 기기. 예비 기기 토큰을 방금 만들었으면 원문을 한 번 싣는다 */
  view(): DeviceSavedView {
    return new DeviceSavedView(this.row, this.issuedToken(DeviceCredential.DEVICE));
  }

  /** 방금 만든 OAuth 토큰 한 쌍 */
  tokenView(): TokenView {
    return new TokenView(
      this.row,
      this.issuedToken(DeviceCredential.ACCESS),
      this.issuedToken(DeviceCredential.REFRESH),
    );
  }

  /** 기기를 연결한 도구 (clientId · clientName) */
  private get meta(): Readonly<Record<string, unknown>> {
    return (this.row.meta ?? {}) as Record<string, unknown>;
  }

  /** 방금 만든 토큰의 원문 (응답에 한 번만) */
  private issuedToken(kind: string): string | undefined {
    return this.issued.find((c) => c.kind === kind)?.token ?? undefined;
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
