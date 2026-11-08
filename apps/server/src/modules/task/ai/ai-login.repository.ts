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

  /** 공간의 이 도구 로그인. 없으면 null */
  async byTool(spaceId: string, tool: string): Promise<AiLogin | null> {
    return this.findOne({ space_id: spaceId, tool });
  }

  /** 공간과 도구의 로그인 한 줄을 잠근다. 없으면 null */
  async lockTool(spaceId: string, tool: string): Promise<AiLogin | null> {
    return this.findOne({ space_id: spaceId, tool }, { lock: true });
  }

  /** 지금 쓸 수 있는 로그인의 도구들 (만료가 없거나 지나지 않은 것) */
  async usableTools(spaceId: string, now: Date): Promise<readonly string[]> {
    const rows = await this.sql<Pick<AiLoginRow, 'tool'>[]>`
      SELECT tool FROM task.ai_logins
      WHERE space_id = ${spaceId} AND (expires_at IS NULL OR expires_at > ${now})`;
    return rows.map((r) => r.tool);
  }

  /** 서버 키를 바꿀 때 모두 잠근다 (id 순서) */
  async lockAll(): Promise<readonly AiLogin[]> {
    return this.find({}, { order: ['id'], lock: true });
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
