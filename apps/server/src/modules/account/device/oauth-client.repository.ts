import { BaseRepository, type Row } from '../../platform';
import { AuthorizationCode } from './authorization-code';
import { OAuthClient } from './oauth-client';

// account.oauth_clients ↔ OAuthClient, account.oauth_codes ↔ AuthorizationCode.
// 둘 다 기기를 만들기 전 단계의 데이터라 한 곳에서 다룬다.
export class OAuthClientRepository extends BaseRepository<OAuthClient> {
  protected toEntity(row: Row): OAuthClient {
    return OAuthClient.restore(
      String(row.client_id),
      String(row.space_id),
      String(row.client_name ?? ''),
      (row.redirect_uris as string[]) ?? [],
    );
  }

  async find(clientId: string): Promise<OAuthClient | null> {
    return this.maybeOne(
      await this.sql`SELECT * FROM account.oauth_clients WHERE client_id = ${clientId}`,
    );
  }

  async save(client: OAuthClient): Promise<void> {
    if (!client.isNew) return;
    await this.sql`
      INSERT INTO account.oauth_clients (client_id, space_id, client_name, redirect_uris)
      VALUES (${client.clientId}, ${client.spaceId}, ${client.clientName}, ${client.redirectUris as string[]})`;
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
    const [row] = await this.sql`
      SELECT * FROM account.oauth_codes WHERE code_hash = ${codeHash} FOR UPDATE`;
    if (!row) return null;
    const draft = (row.device_draft ?? {}) as Record<string, string>;
    return AuthorizationCode.restore(
      String(row.code_hash),
      String(row.client_id),
      String(row.redirect_uri),
      String(row.code_challenge),
      String(draft.spaceId ?? ''),
      String(draft.userId ?? ''),
      String(draft.name ?? ''),
      String(draft.clientName ?? ''),
      new Date(row.expires_at),
      row.used_at === null ? null : new Date(row.used_at),
    );
  }

  async saveCode(code: AuthorizationCode): Promise<void> {
    const draft = {
      spaceId: code.spaceId,
      userId: code.userId,
      name: code.deviceName,
      clientName: code.clientName,
    };
    await this.sql`
      INSERT INTO account.oauth_codes
        (code_hash, client_id, redirect_uri, code_challenge, device_draft, expires_at, used_at)
      VALUES (${code.codeHash}, ${code.clientId}, ${code.redirectUri}, ${code.codeChallenge},
              ${this.sql.json(draft)}, ${code.expiresAt}, ${code.used})
      ON CONFLICT (code_hash) DO UPDATE SET used_at = EXCLUDED.used_at`;
  }
}
