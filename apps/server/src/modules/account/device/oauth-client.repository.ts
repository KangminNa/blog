import { BaseRepository } from '../../platform';
import type { OauthClientRow, OauthCodeRow } from '../account.tables';
import { AuthorizationCode } from './authorization-code';
import { OAuthClient } from './oauth-client';

// account.oauth_clients ↔ OAuthClient, account.oauth_codes ↔ AuthorizationCode.
// 둘 다 기기를 만들기 전 단계의 데이터라 한 곳에서 다룬다. 열쇠가 id가 아니라 TableRepository를 쓰지 않는다.
export class OAuthClientRepository extends BaseRepository<OAuthClient> {
  protected toEntity(row: OauthClientRow): OAuthClient {
    return OAuthClient.restore(row);
  }

  async find(clientId: string): Promise<OAuthClient | null> {
    return this.maybeOne(
      await this.sql`SELECT * FROM account.oauth_clients WHERE client_id = ${clientId}`,
    );
  }

  /** 새로 등록한 클라이언트를 넣는다 (등록은 고치지 않는다) */
  async save(client: OAuthClient): Promise<void> {
    await this.sql`INSERT INTO account.oauth_clients ${this.sql(client.unsaved as never)}`;
  }

  /** before보다 먼저 등록했는데 토큰을 한 번도 받지 않은 클라이언트를 지운다 (승인 코드도 함께) */
  async deleteUnused(before: Date): Promise<void> {
    await this.sql`
      DELETE FROM account.oauth_clients c
      WHERE c.created_at < ${before}
        AND NOT EXISTS (SELECT 1 FROM account.oauth_tokens t WHERE t.client_id = c.client_id)`;
  }

  /** 승인 코드를 잠그고 읽는다 (한 번만 쓰이게) */
  async lockCode(codeHash: string): Promise<AuthorizationCode | null> {
    const [row] = await this.sql<OauthCodeRow[]>`
      SELECT * FROM account.oauth_codes WHERE code_hash = ${codeHash} FOR UPDATE`;
    return row ? AuthorizationCode.restore(row) : null;
  }

  /** 새 코드는 넣고, 이미 있는 코드는 쓴 때만 고친다 */
  async saveCode(code: AuthorizationCode): Promise<void> {
    await this.sql`
      INSERT INTO account.oauth_codes ${this.sql(code.unsaved as never)}
      ON CONFLICT (code_hash) DO UPDATE SET used_at = EXCLUDED.used_at`;
  }
}
