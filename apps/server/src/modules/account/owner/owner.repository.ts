import { BaseRepository, Conflict, Database } from '../../platform';
import type { UserRow } from '../account.tables';
import { Owner, type OwnerRow, WebSession } from './owner';

// account.users + space_members(주인) + web_sessions + login_links ↔ Owner.
// users에는 space_id도 version도 없어 TableRepository가 맞지 않는다. 계정 행의 저장은 여기서 한다.
export class OwnerRepository extends BaseRepository<Owner> {
  protected toEntity(row: OwnerRow): Owner {
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
      SELECT u.*, m.space_id FROM account.login_links l
      JOIN account.users u ON u.id = l.user_id
      JOIN account.space_members m ON m.user_id = u.id AND m.role = 'owner'
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
    const [row] = await this.sql<(OwnerRow & { session_id: string; expires_at: Date })[]>`
      SELECT u.*, m.space_id, w.id AS session_id, w.expires_at
      FROM account.web_sessions w
      JOIN account.users u ON u.id = w.user_id
      JOIN account.space_members m ON m.user_id = u.id AND m.role = 'owner'
      WHERE w.token_hash = ${tokenHash} AND w.revoked_at IS NULL AND w.expires_at > now()`;
    if (!row) return null;
    return Owner.restore(row, [
      WebSession.restore({
        id: row.session_id,
        user_id: row.id,
        token_hash: tokenHash,
        expires_at: row.expires_at,
      }),
    ]);
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
      if (s.isNew) await this.sql`INSERT INTO account.web_sessions ${this.sql(s.unsaved as never)}`;
      else
        await this.sql`
          UPDATE account.web_sessions SET revoked_at = now() WHERE id = ${s.id} AND revoked_at IS NULL`;
    }
    for (const method of owner.removedLinks)
      await this
        .sql`DELETE FROM account.login_links WHERE user_id = ${owner.id} AND method = ${method}`;
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
    if (fresh)
      await this.sql`INSERT INTO account.space_members ${this.sql(owner.membership as never)}`;
    if (row) owner.saved(row);
  }

  /** 주인 자리까지 함께 읽는 SQL의 앞부분 */
  private get owners() {
    return this.sql`
      SELECT u.*, m.space_id FROM account.users u
      JOIN account.space_members m ON m.user_id = u.id AND m.role = 'owner'`;
  }
}
