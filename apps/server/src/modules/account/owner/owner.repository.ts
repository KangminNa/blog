import { BaseRepository, Conflict, Database, type Row } from '../../platform';
import { Owner, WebSession } from './owner';

// account.users + space_members(주인) + web_sessions ↔ Owner
export class OwnerRepository extends BaseRepository<Owner> {
  protected toEntity(row: Row): Owner {
    return Owner.restore(
      String(row.id),
      String(row.space_id),
      String(row.login),
      row.password_hash === null ? null : String(row.password_hash),
    );
  }

  /** 아이디로 주인을 찾는다 (주인이 아닌 계정은 없다) */
  async findByLogin(login: string): Promise<Owner | null> {
    return this.maybeOne(
      await this.sql`
      SELECT u.*, m.space_id FROM account.users u
      JOIN account.space_members m ON m.user_id = u.id AND m.role = 'owner'
      WHERE u.login = ${login}`,
    );
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
    return this.maybeOne(
      await this.sql`
      SELECT u.*, m.space_id FROM account.users u
      JOIN account.space_members m ON m.user_id = u.id AND m.role = 'owner'
      WHERE u.id = ${id}`,
    );
  }

  /** 공간의 주인 (명령줄의 비밀번호 다시 정하기) */
  async findOnly(): Promise<Owner | null> {
    return this.maybeOne(
      await this.sql`
      SELECT u.*, m.space_id FROM account.users u
      JOIN account.space_members m ON m.user_id = u.id AND m.role = 'owner'
      ORDER BY m.created_at LIMIT 1`,
    );
  }

  /** 로그인 토큰으로 찾는다 (로그아웃, 비밀번호 바꾸기). 그 로그인 하나만 함께 불러온다 */
  async findBySession(tokenHash: string): Promise<Owner | null> {
    const [row] = await this.sql`
      SELECT u.*, m.space_id, w.id AS session_id, w.expires_at, w.ip, w.user_agent
      FROM account.web_sessions w
      JOIN account.users u ON u.id = w.user_id
      JOIN account.space_members m ON m.user_id = u.id AND m.role = 'owner'
      WHERE w.token_hash = ${tokenHash} AND w.revoked_at IS NULL AND w.expires_at > now()`;
    if (!row) return null;
    return Owner.restore(
      String(row.id),
      String(row.space_id),
      String(row.login),
      row.password_hash === null ? null : String(row.password_hash),
      [
        WebSession.restore(
          String(row.session_id),
          tokenHash,
          new Date(row.expires_at),
          String(row.ip ?? ''),
          String(row.user_agent ?? ''),
        ),
      ],
    );
  }

  async save(owner: Owner): Promise<void> {
    try {
      if (owner.isNew) {
        await this.sql`
          INSERT INTO account.users (id, login, password_hash, password_changed_at)
          VALUES (${owner.id}, ${owner.login}, ${owner.passwordHash}, now())`;
        await this.sql`
          INSERT INTO account.space_members (space_id, user_id, role)
          VALUES (${owner.spaceId}, ${owner.id}, 'owner')`;
      } else {
        await this.sql`
          UPDATE account.users SET password_hash = ${owner.passwordHash},
            password_changed_at = CASE WHEN ${owner.endsOtherSessions} THEN now() ELSE password_changed_at END
          WHERE id = ${owner.id}`;
      }
    } catch (error) {
      // 두 브라우저가 동시에 주인이 되려 하면 DB의 "주인은 한 명" 규칙이 하나만 들인다
      if (Database.isUniqueViolation(error)) throw new Conflict('이미 주인이 정해졌어요');
      throw error;
    }
    if (owner.endsOtherSessions)
      await this.sql`
        UPDATE account.web_sessions SET revoked_at = now()
        WHERE user_id = ${owner.id} AND revoked_at IS NULL
          AND id IS DISTINCT FROM ${owner.keptSessionId}`;
    for (const s of owner.changedSessions) {
      if (s.isNew)
        await this.sql`
          INSERT INTO account.web_sessions (id, user_id, token_hash, ip, user_agent, expires_at)
          VALUES (${s.id}, ${owner.id}, ${s.tokenHash}, ${s.ip || null}, ${s.userAgent}, ${s.expiresAt})`;
      else
        await this.sql`
          UPDATE account.web_sessions SET revoked_at = now() WHERE id = ${s.id} AND revoked_at IS NULL`;
    }
    for (const method of owner.removedLinks)
      await this
        .sql`DELETE FROM account.login_links WHERE user_id = ${owner.id} AND method = ${method}`;
    for (const link of owner.newLinks)
      await this.sql`
        INSERT INTO account.login_links (method, subject, user_id, label)
        VALUES (${link.method}, ${link.subject}, ${owner.id}, ${link.label})
        ON CONFLICT (method, subject) DO UPDATE SET user_id = EXCLUDED.user_id, label = EXCLUDED.label`;
    await this.publishEvents(owner);
  }
}
