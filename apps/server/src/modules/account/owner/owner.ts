import { createHash, randomBytes } from 'node:crypto';
import { BaseEntity, DomainEvent, TableEntity } from '../../platform';
import type {
  LoginLinkNew,
  SpaceMemberNew,
  UserNew,
  UserRow,
  WebSessionNew,
  WebSessionRow,
} from '../account.tables';

/** 주인 한 줄: 계정에 주인 자리의 공간을 더해 읽는다 */
export type LoadedOwner = UserRow & { space_id: string };

/** 관리 화면 로그인 한 번 (web_sessions). 토큰 원문은 만든 순간에만 메모리에 있고, DB에는 해시만 둔다 */
export class WebSession extends TableEntity<WebSessionRow, WebSessionNew> {
  static readonly COOKIE = 'cairn_session';
  static readonly DAYS = 30;

  private constructor(
    row: WebSessionRow | WebSessionNew,
    /** 만든 순간에만 있는 원문 (쿠키로 한 번 나간다) */
    readonly token: string | null,
  ) {
    super(row, token !== null);
  }

  static start(userId: string, ip: string, userAgent: string, now: Date): WebSession {
    const token = randomBytes(32).toString('base64url');
    return new WebSession(
      {
        id: BaseEntity.newId(),
        user_id: userId,
        token_hash: WebSession.hash(token),
        ip: ip || null,
        user_agent: userAgent,
        expires_at: new Date(now.getTime() + WebSession.DAYS * 86_400_000),
      },
      token,
    );
  }

  static restore(row: WebSessionRow): WebSession {
    return new WebSession(row, null);
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 저장할 것이 있는가 (새로 만들었거나 끝냈다) */
  get changed(): boolean {
    return Object.keys(this.unsaved).length > 0;
  }

  matches(tokenHash: string): boolean {
    return this.row.token_hash === tokenHash;
  }

  end(now: Date): void {
    this.put('revoked_at', now);
  }
}

// 블로그 주인: 계정(users: 아이디·비밀번호) + 주인 자리(space_members) + 로그인들(web_sessions) + 연결한 외부 계정(login_links).
// 주인은 공간마다 한 명이고, 설치 통행증을 가진 브라우저에서 만든 계정이 된다 (확인은 InstallPolicy).
// 비밀번호는 바꾼 값(PasswordHasher)만 들고 있다.
export class Owner extends TableEntity<UserRow, UserNew> {
  private static readonly ROLE = 'owner';
  private readonly sessions: WebSession[] = [];
  private passwordChanged = false;
  private keepOnPasswordChange: string | null = null;
  private readonly linked: LoginLinkNew[] = [];
  private readonly unlinked = new Set<string>();

  private constructor(
    row: UserRow | UserNew,
    private readonly spaceId: string,
    fresh = false,
  ) {
    super(row, fresh);
  }

  static create(spaceId: string, login: string, passwordHash: string, now: Date): Owner {
    const owner = new Owner(
      { id: BaseEntity.newId(), login, password_hash: passwordHash, password_changed_at: now },
      spaceId,
      true,
    );
    owner.record(new DomainEvent('account.owner.claimed', 1, spaceId, { userId: owner.id, login }));
    return owner;
  }

  static restore(row: LoadedOwner, sessions: readonly WebSession[] = []): Owner {
    const owner = new Owner(row, row.space_id);
    owner.sessions.push(...sessions);
    return owner;
  }

  get login(): string {
    return this.row.login;
  }

  get passwordHash(): string | null {
    return this.row.password_hash;
  }

  /** 칸이 그대로여도 저장하면 계정 행을 고친다: 같은 주인의 저장(로그인, 비밀번호 바꾸기)이 그 행에서 차례를 기다린다 */
  override get unsaved(): Partial<UserRow> {
    const changed = super.unsaved;
    return Object.keys(changed).length > 0 ? changed : { password_hash: this.row.password_hash };
  }

  /** 주인 자리 행. 새 주인을 저장할 때 Repository가 부른다 */
  get membership(): SpaceMemberNew {
    return { space_id: this.spaceId, user_id: this.id, role: Owner.ROLE };
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
    return this.sessions.filter((s) => s.changed);
  }

  /** 저장할 연결 (새로 연결한 것) */
  get newLinks(): readonly LoginLinkNew[] {
    return this.linked;
  }

  /** 저장할 연결 끊기 (방법 이름) */
  get removedLinks(): readonly string[] {
    return [...this.unlinked];
  }

  /** 비밀번호를 바꾼다. keep 말고 다른 로그인은 모두 끝난다 (다른 곳에서 훔친 로그인이 있어도 끊기게) */
  setPassword(hash: string, keep: WebSession | null, now: Date): void {
    this.put('password_hash', hash);
    this.put('password_changed_at', now);
    this.passwordChanged = true;
    this.keepOnPasswordChange = keep?.id ?? null;
  }

  /** 같은 비밀번호를 더 강하게 다시 저장한다. 로그인은 그대로 둔다 */
  rehashPassword(hash: string): void {
    this.put('password_hash', hash);
  }

  startSession(ip: string, userAgent: string, now: Date): WebSession {
    const session = WebSession.start(this.id, ip, userAgent, now);
    this.sessions.push(session);
    return session;
  }

  session(tokenHash: string): WebSession | null {
    return this.sessions.find((s) => s.matches(tokenHash)) ?? null;
  }

  /** 지금 로그인을 끝낸다 (로그아웃) */
  endSession(tokenHash: string, now: Date): void {
    this.session(tokenHash)?.end(now);
  }

  /** 외부 계정을 연결한다. 같은 방법으로 이미 연결한 계정이 있으면 바꾼다 */
  link(method: string, subject: string, label: string): void {
    this.unlinked.add(method);
    this.linked.push({ method, subject, user_id: this.id, label });
  }

  unlink(method: string): void {
    this.unlinked.add(method);
  }
}
