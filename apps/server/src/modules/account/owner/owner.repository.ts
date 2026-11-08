import { BaseRepository, Conflict, Database } from '../../platform';
import { loginLinks, spaceMembers, webSessions } from '../account.schema';
import type { UserRow, WebSessionRow } from '../account.tables';
import { type LoadedOwner, Owner, WebSession } from './owner';

// account.users + space_members(주인) + web_sessions + login_links ↔ Owner.
// users에는 space_id도 version도 없어 TableRepository가 맞지 않는다. 계정 행은 여기서 바뀐 칸으로 저장한다.
export class OwnerRepository extends BaseRepository<Owner> {
  protected toEntity(row: LoadedOwner): Owner {
    return Owner.restore(row);
  }

  /** 아이디로 주인을 찾는다 (주인이 아닌 계정은 없다) */
  async findByLogin(login: string): Promise<Owner | null> {
    return this.maybeOne(await this.sql`${this.owners} WHERE u.login = ${login}`);
  }

  /** 연결한 외부 계정으로 주인을 찾는다 (외부 로그인) */
  async findByLink(method: string, subject: string): Promise<Owner | null> {
    return this.maybeOne(
      await this.sql`
        ${this.owners} JOIN account.login_links l ON l.user_id = u.id
        WHERE l.method = ${method} AND l.subject = ${subject}`,
    );
  }

  async findById(id: string): Promise<Owner | null> {
    return this.maybeOne(await this.sql`${this.owners} WHERE u.id = ${id}`);
  }

  /** 공간의 주인 (명령줄의 비밀번호 다시 정하기) */
  async findOnly(): Promise<Owner | null> {
    return this.maybeOne(await this.sql`${this.owners} ORDER BY m.created_at LIMIT 1`);
  }

  /** 로그인 토큰으로 찾는다 (로그아웃, 비밀번호 바꾸기). 그 로그인 하나만 함께 불러온다 */
  async findBySession(tokenHash: string): Promise<Owner | null> {
    const [session] = await this.sql<WebSessionRow[]>`
      SELECT * FROM account.web_sessions
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL AND expires_at > now()`;
    if (!session) return null;
    const [row] = await this.sql<LoadedOwner[]>`${this.owners} WHERE u.id = ${session.user_id}`;
    return row ? Owner.restore(row, [WebSession.restore(session)]) : null;
  }

  async save(owner: Owner): Promise<void> {
    try {
      await this.saveAccount(owner);
    } catch (error) {
      // 두 브라우저가 동시에 주인이 되려 하면 DB의 "주인은 한 명" 규칙이 하나만 들인다
      if (Database.isUniqueViolation(error))
        throw new Conflict('관리자 계정은 하나만 만들 수 있어요');
      throw error;
    }
    if (owner.endsOtherSessions)
      await this.sql`
        UPDATE account.web_sessions SET revoked_at = now()
        WHERE user_id = ${owner.id} AND revoked_at IS NULL
          AND id IS DISTINCT FROM ${owner.keptSessionId}`;
    for (const s of owner.changedSessions) {
      if (s.isNew) await this.insertRows(webSessions, s.unsaved);
      else await this.updateRows(webSessions, s.unsaved, { id: s.id, revoked_at: null });
    }
    for (const method of owner.removedLinks)
      await this.deleteRows(loginLinks, { user_id: owner.id, method });
    for (const link of owner.newLinks)
      await this.sql`
        INSERT INTO account.login_links ${this.sql(link as never)}
        ON CONFLICT (method, subject) DO UPDATE SET user_id = EXCLUDED.user_id, label = EXCLUDED.label`;
    await this.publishEvents(owner);
  }

  /** 새 주인이면 계정과 주인 자리를 넣고, 아니면 바뀐 칸만 고친다 */
  private async saveAccount(owner: Owner): Promise<void> {
    const fresh = owner.isNew;
    const [row] = fresh
      ? await this.sql<UserRow[]>`
          INSERT INTO account.users ${this.sql(owner.unsaved as never)} RETURNING *`
      : await this.sql<UserRow[]>`
          UPDATE account.users SET ${this.sql(owner.unsaved as never)} WHERE id = ${owner.id}
          RETURNING *`;
    if (fresh) await this.insertRows(spaceMembers, owner.membership);
    if (row) owner.saved(row);
  }

  /** 주인 자리까지 함께 읽는 SQL의 앞부분 */
  private get owners() {
    return this.sql`
      SELECT u.*, m.space_id FROM account.users u
      JOIN account.space_members m ON m.user_id = u.id AND m.role = 'owner'`;
  }
}
