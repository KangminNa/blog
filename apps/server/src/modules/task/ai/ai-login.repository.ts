import { TableRepository } from '../../platform';
import { aiLogins } from '../task.schema';
import type { AiLoginRow } from '../task.tables';
import { AiLogin } from './ai-login';

// task.ai_logins ↔ AiLogin. 공간과 도구마다 한 줄이다. 고치기는 기반이 하고, 처음 넣기만 여기서 한다.
export class AiLoginRepository extends TableRepository<AiLoginRow, AiLogin> {
  protected readonly table = aiLogins;
  protected readonly noun = 'AI 로그인';

  protected toEntity(row: AiLoginRow): AiLogin {
    return AiLogin.restore(row);
  }

  async find(spaceId: string, tool: string): Promise<AiLogin | null> {
    return this.maybeOne(
      await this.sql`
        SELECT * FROM task.ai_logins WHERE space_id = ${spaceId} AND tool = ${tool}`,
    );
  }

  async lockTool(spaceId: string, tool: string): Promise<AiLogin | null> {
    return this.maybeOne(
      await this.sql`
        SELECT * FROM task.ai_logins WHERE space_id = ${spaceId} AND tool = ${tool} FOR UPDATE`,
    );
  }

  /** 지금 쓸 수 있는 로그인의 도구들 (만료가 없거나 지나지 않은 것) */
  async usableTools(spaceId: string, now: Date): Promise<readonly string[]> {
    const rows = await this.sql<Pick<AiLoginRow, 'tool'>[]>`
      SELECT tool FROM task.ai_logins
      WHERE space_id = ${spaceId} AND (expires_at IS NULL OR expires_at > ${now})`;
    return rows.map((r) => r.tool);
  }

  /** 서버 키를 바꿀 때 모두 잠근다 */
  async lockAll(): Promise<readonly AiLogin[]> {
    const rows = await this.sql<AiLoginRow[]>`SELECT * FROM task.ai_logins ORDER BY id FOR UPDATE`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 처음 넣는 저장이 동시에 와도 줄은 하나다: 뒤의 값이 앞의 값을 바꾼다 */
  override async save(login: AiLogin): Promise<void> {
    if (!login.isNew) return super.save(login);
    const [row] = await this.sql<AiLoginRow[]>`
      INSERT INTO task.ai_logins ${this.sql(login.unsaved as never)}
      ON CONFLICT (space_id, tool) DO UPDATE
      SET secret = EXCLUDED.secret, nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at,
        checked_at = NULL, last_error = NULL, version = task.ai_logins.version + 1
      RETURNING *`;
    if (row) login.saved(row);
  }
}
