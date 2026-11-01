import { BaseRepository, type Row, SealedSecret } from '../../platform';
import { AiLogin } from './ai-login';

// task.ai_logins ↔ AiLogin. 공간과 도구마다 한 줄이다.
export class AiLoginRepository extends BaseRepository<AiLogin> {
  protected toEntity(row: Row): AiLogin {
    return AiLogin.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      String(row.tool),
      new SealedSecret(Buffer.from(row.secret), Buffer.from(row.nonce)),
      new Date(row.expires_at),
      row.checked_at === null ? null : new Date(row.checked_at),
      row.last_error === null ? null : String(row.last_error),
      new Date(row.created_at),
    );
  }

  async find(spaceId: string, tool: string): Promise<AiLogin | null> {
    return this.maybeOne(
      await this.sql`
        SELECT * FROM task.ai_logins WHERE space_id = ${spaceId} AND tool = ${tool}`,
    );
  }

  async lock(spaceId: string, tool: string): Promise<AiLogin | null> {
    return this.maybeOne(
      await this.sql`
        SELECT * FROM task.ai_logins WHERE space_id = ${spaceId} AND tool = ${tool} FOR UPDATE`,
    );
  }

  /** 서버 키를 바꿀 때 모두 잠근다 */
  async lockAll(): Promise<readonly AiLogin[]> {
    const rows = await this.sql`SELECT * FROM task.ai_logins ORDER BY id FOR UPDATE`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 처음 넣는 저장이 동시에 와도 줄은 하나다: 뒤의 값이 앞의 값을 바꾼다 */
  async save(login: AiLogin): Promise<void> {
    if (login.isNew) {
      await this.sql`
        INSERT INTO task.ai_logins (id, space_id, tool, secret, nonce, expires_at, created_at)
        VALUES (${login.id}, ${login.spaceId}, ${login.tool}, ${login.sealed.ciphertext},
          ${login.sealed.nonce}, ${login.expiresAt}, ${login.createdAt})
        ON CONFLICT (space_id, tool) DO UPDATE
        SET secret = EXCLUDED.secret, nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at,
          checked_at = NULL, last_error = NULL, version = task.ai_logins.version + 1`;
    } else if (login.changed) {
      const result = await this.sql`
        UPDATE task.ai_logins SET ${this.sql(login.changes)}, version = version + 1
        WHERE id = ${login.id} AND version = ${login.version}`;
      this.expectUpdated(result.count, login);
    }
    login.clearChanges();
  }
}
