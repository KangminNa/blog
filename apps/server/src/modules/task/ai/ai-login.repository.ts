import { and, asc, eq, gt, isNull, or, QueryTemplate, TableRepository } from '../../platform';
import { aiLogins } from '../task.schema';
import type { AiLoginRow } from '../task.tables';
import { AiLogin } from './ai-login';

// task.ai_logins ↔ AiLogin. 공간과 도구마다 한 줄이다. 고치기는 기반이 하고, 처음 넣기만 여기서 한다.
export class AiLoginRepository extends TableRepository<AiLoginRow, AiLogin> {
  /** 공간과 도구의 로그인 한 줄 */
  private static readonly BY_TOOL = QueryTemplate.of<{ space: string; tool: string }, AiLoginRow>(
    (q) =>
      q
        .select()
        .from(aiLogins)
        .where(
          and(
            eq(aiLogins.space_id, QueryTemplate.value('space')),
            eq(aiLogins.tool, QueryTemplate.value('tool')),
          ),
        ),
  );
  /** 공간과 도구의 로그인 한 줄을 잠근다 */
  private static readonly LOCK_TOOL = QueryTemplate.of<{ space: string; tool: string }, AiLoginRow>(
    (q) =>
      q
        .select()
        .from(aiLogins)
        .where(
          and(
            eq(aiLogins.space_id, QueryTemplate.value('space')),
            eq(aiLogins.tool, QueryTemplate.value('tool')),
          ),
        )
        .for('update'),
  );
  /** 공간에서 만료가 없거나 지나지 않은 로그인의 도구 */
  private static readonly USABLE = QueryTemplate.of<
    { space: string; now: Date },
    Pick<AiLoginRow, 'tool'>
  >((q) =>
    q
      .select({ tool: aiLogins.tool })
      .from(aiLogins)
      .where(
        and(
          eq(aiLogins.space_id, QueryTemplate.value('space')),
          or(isNull(aiLogins.expires_at), gt(aiLogins.expires_at, QueryTemplate.value('now'))),
        ),
      ),
  );
  /** 모든 공간의 로그인을 id 순서로 잠근다 */
  private static readonly LOCK_ALL = QueryTemplate.of<Record<string, never>, AiLoginRow>((q) =>
    q.select().from(aiLogins).orderBy(asc(aiLogins.id)).for('update'),
  );

  protected readonly table = aiLogins;
  protected readonly noun = 'AI 로그인';

  protected toEntity(row: AiLoginRow): AiLogin {
    return AiLogin.restore(row);
  }

  /** 공간의 이 도구 로그인. 없으면 null */
  async byTool(spaceId: string, tool: string): Promise<AiLogin | null> {
    return this.maybeOne(await AiLoginRepository.BY_TOOL.rows(this.sql, { space: spaceId, tool }));
  }

  async lockTool(spaceId: string, tool: string): Promise<AiLogin | null> {
    return this.maybeOne(
      await AiLoginRepository.LOCK_TOOL.rows(this.sql, { space: spaceId, tool }),
    );
  }

  /** 지금 쓸 수 있는 로그인의 도구들 (만료가 없거나 지나지 않은 것) */
  async usableTools(spaceId: string, now: Date): Promise<readonly string[]> {
    const rows = await AiLoginRepository.USABLE.rows(this.sql, { space: spaceId, now });
    return rows.map((r) => r.tool);
  }

  /** 서버 키를 바꿀 때 모두 잠근다 */
  async lockAll(): Promise<readonly AiLogin[]> {
    const rows = await AiLoginRepository.LOCK_ALL.rows(this.sql, {});
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
