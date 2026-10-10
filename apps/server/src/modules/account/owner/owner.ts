import { createHash, randomBytes } from 'node:crypto';
import { BaseEntity, DomainEvent } from '../../platform';

/** 관리 화면 로그인 한 번. 토큰 원문은 만든 순간에만 메모리에 있고, DB에는 해시만 둔다 */
export class WebSession {
  static readonly COOKIE = 'cairn_session';
  static readonly DAYS = 30;

  private constructor(
    readonly id: string,
    readonly tokenHash: string,
    readonly expiresAt: Date,
    readonly ip: string,
    readonly userAgent: string,
    readonly token: string | null,
    private endedFlag: boolean,
  ) {}

  static start(id: string, ip: string, userAgent: string, now: Date): WebSession {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(now.getTime() + WebSession.DAYS * 86_400_000);
    return new WebSession(id, WebSession.hash(token), expires, ip, userAgent, token, false);
  }

  static restore(
    id: string,
    tokenHash: string,
    expiresAt: Date,
    ip: string,
    userAgent: string,
  ): WebSession {
    return new WebSession(id, tokenHash, expiresAt, ip, userAgent, null, false);
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  get isNew(): boolean {
    return this.token !== null;
  }

  get ended(): boolean {
    return this.endedFlag;
  }

  end(): void {
    this.endedFlag = true;
  }
}

/** 주인에게 연결한 외부 계정 하나 (로그인 플러그인으로 확인한 계정). 방법마다 하나 */
export class LoginLink {
  constructor(
    readonly method: string,
    readonly subject: string,
    readonly label: string,
  ) {}
}

// 블로그 주인: 계정(users: 아이디·비밀번호) + 주인 자리(space_members) + 로그인들(web_sessions) + 연결한 외부 계정(login_links).
// 주인은 공간마다 한 명이고, 설치 통행증을 가진 브라우저에서 만든 계정이 된다 (확인은 InstallPolicy).
// 비밀번호는 바꾼 값(PasswordHasher)만 들고 있다.
export class Owner extends BaseEntity {
  private readonly sessions: WebSession[] = [];
  private passwordChanged = false;
  private keepOnPasswordChange: string | null = null;
  private readonly linked: LoginLink[] = [];
  private readonly unlinked = new Set<string>();

  private constructor(
    id: string,
    readonly spaceId: string,
    readonly login: string,
    private hash: string | null,
    readonly isNew: boolean,
  ) {
    super(id, 1);
  }

  static create(spaceId: string, login: string, passwordHash: string): Owner {
    const owner = new Owner(BaseEntity.newId(), spaceId, login, passwordHash, true);
    owner.record(new DomainEvent('account.owner.claimed', 1, spaceId, { userId: owner.id, login }));
    return owner;
  }

  static restore(
    id: string,
    spaceId: string,
    login: string,
    passwordHash: string | null,
    sessions: readonly WebSession[] = [],
  ): Owner {
    const owner = new Owner(id, spaceId, login, passwordHash, false);
    owner.sessions.push(...sessions);
    return owner;
  }

  get passwordHash(): string | null {
    return this.hash;
  }

  /** 비밀번호가 바뀌어 다른 로그인을 끝내야 하는가 */
  get endsOtherSessions(): boolean {
    return this.passwordChanged;
  }

  /** 비밀번호를 바꿀 때 남겨 둘 로그인 (바꾼 사람의 지금 로그인). 없으면 모두 끝낸다 */
  get keptSessionId(): string | null {
    return this.keepOnPasswordChange;
  }

  /** 저장할 로그인 (새로 만든 것, 끝낸 것) */
  get changedSessions(): readonly WebSession[] {
    return this.sessions.filter((s) => s.isNew || s.ended);
  }

  /**
   * 비밀번호를 바꾼다. keep 말고 다른 로그인은 모두 끝난다 (다른 곳에서 훔친 로그인이 있어도 끊기게).
   * 같은 비밀번호를 더 강하게 다시 저장할 때는 keepAll로 로그인을 그대로 둔다.
   */
  setPassword(hash: string, keep: WebSession | null, keepAll = false): void {
    this.hash = hash;
    if (keepAll) return;
    this.passwordChanged = true;
    this.keepOnPasswordChange = keep?.id ?? null;
  }

  startSession(ip: string, userAgent: string, now: Date): WebSession {
    const session = WebSession.start(BaseEntity.newId(), ip, userAgent, now);
    this.sessions.push(session);
    return session;
  }

  session(tokenHash: string): WebSession | null {
    return this.sessions.find((s) => s.tokenHash === tokenHash) ?? null;
  }

  /** 저장할 연결 (새로 연결한 것) */
  get newLinks(): readonly LoginLink[] {
    return this.linked;
  }

  /** 저장할 연결 끊기 (방법 이름) */
  get removedLinks(): readonly string[] {
    return [...this.unlinked];
  }

  /** 외부 계정을 연결한다. 같은 방법으로 이미 연결한 계정이 있으면 바꾼다 */
  link(method: string, subject: string, label: string): void {
    this.unlinked.add(method);
    this.linked.push(new LoginLink(method, subject, label));
  }

  unlink(method: string): void {
    this.unlinked.add(method);
  }

  /** 지금 로그인을 끝낸다 (로그아웃) */
  endSession(tokenHash: string): void {
    this.session(tokenHash)?.end();
  }
}
