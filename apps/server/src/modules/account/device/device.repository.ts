import { BaseRepository, Conflict, Database, type Row } from '../../platform';
import { Device, DeviceCredential } from './device';

// account.devices + oauth_tokens + device_tokens ↔ Device
export class DeviceRepository extends BaseRepository<Device> {
  protected toEntity(row: Row): Device {
    return Device.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      row.user_id === null ? null : String(row.user_id),
      String(row.name),
      (row.scopes as string[]) ?? [],
      (row.meta?.clientId as string | undefined) ?? null,
      String(row.meta?.clientName ?? ''),
      new Date(row.created_at),
      row.revoked_at === null ? null : new Date(row.revoked_at),
      row.token_kind
        ? DeviceCredential.restore(
            String(row.token_kind),
            String(row.token_hash),
            row.token_expires_at === null ? null : new Date(row.token_expires_at),
            row.token_revoked_at === null ? null : new Date(row.token_revoked_at),
          )
        : null,
    );
  }

  /** 끊지 않은 기기 중에 같은 이름이 있는가 (승인 화면에서 먼저 알려주려고) */
  async nameTaken(spaceId: string, name: string): Promise<boolean> {
    const [row] = await this.sql`
      SELECT 1 FROM account.devices
      WHERE space_id = ${spaceId} AND name = ${name.trim()} AND revoked_at IS NULL`;
    return Boolean(row);
  }

  /** 트랜잭션 안에서 잠그고 읽는다 */
  async lock(id: string): Promise<Device | null> {
    return this.maybeOne(await this.sql`SELECT * FROM account.devices WHERE id = ${id} FOR UPDATE`);
  }

  /** 갱신 토큰으로 기기를 찾아 잠근다 (이미 무효인 토큰도 찾는다: 재사용 감지) */
  async lockByRefresh(tokenHash: string): Promise<Device | null> {
    return this.maybeOne(
      await this.sql`
      SELECT d.*, t.kind AS token_kind, t.token_hash, t.expires_at AS token_expires_at,
             t.revoked_at AS token_revoked_at
      FROM account.oauth_tokens t JOIN account.devices d ON d.id = t.device_id
      WHERE t.token_hash = ${tokenHash} AND t.kind = 'refresh'
      FOR UPDATE OF d`,
    );
  }

  /** 아무 토큰(access·refresh·기기 토큰)으로 기기를 찾는다 (토큰 무효로 하기) */
  async lockByAnyToken(tokenHash: string): Promise<Device | null> {
    return this.maybeOne(
      await this.sql`
      SELECT d.* FROM account.devices d
      WHERE d.id IN (
        SELECT device_id FROM account.oauth_tokens WHERE token_hash = ${tokenHash}
        UNION SELECT device_id FROM account.device_tokens WHERE token_hash = ${tokenHash})
      FOR UPDATE`,
    );
  }

  async save(device: Device): Promise<void> {
    const meta = { clientId: device.clientId, clientName: device.clientName };
    try {
      if (device.isNew) {
        await this.sql`
          INSERT INTO account.devices (id, space_id, user_id, name, scopes, meta, created_at)
          VALUES (${device.id}, ${device.spaceId}, ${device.userId}, ${device.name},
                  ${device.scopes as string[]}, ${this.sql.json(meta)}, ${device.createdAt})`;
        device.markSaved(device.version);
      } else {
        const result = await this.sql`
          UPDATE account.devices SET name = ${device.name}, scopes = ${device.scopes as string[]},
            revoked_at = ${device.revokedAt}, version = version + 1
          WHERE id = ${device.id} AND version = ${device.version}`;
        this.expectUpdated(result.count, device);
      }
    } catch (error) {
      if (Database.isUniqueViolation(error))
        throw new Conflict(`이미 쓰는 기기 이름이에요: ${device.name}. 다른 이름을 써 주세요`);
      throw error;
    }
    for (const hash of device.retiredHashes) {
      await this.sql`
        UPDATE account.oauth_tokens SET revoked_at = now()
        WHERE token_hash = ${hash} AND revoked_at IS NULL`;
      await this.sql`
        UPDATE account.device_tokens SET revoked_at = now()
        WHERE token_hash = ${hash} AND revoked_at IS NULL`;
    }
    if (device.revokedAt) {
      await this.sql`
        UPDATE account.oauth_tokens SET revoked_at = now()
        WHERE device_id = ${device.id} AND revoked_at IS NULL`;
      await this.sql`
        UPDATE account.device_tokens SET revoked_at = now()
        WHERE device_id = ${device.id} AND revoked_at IS NULL`;
    }
    for (const c of device.newCredentials) {
      if (c.kind === DeviceCredential.DEVICE)
        await this.sql`
          INSERT INTO account.device_tokens (device_id, token_hash, prefix, expires_at)
          VALUES (${device.id}, ${c.hash}, ${c.prefix}, ${c.expiresAt})`;
      else
        await this.sql`
          INSERT INTO account.oauth_tokens (device_id, client_id, kind, token_hash, scopes, expires_at)
          VALUES (${device.id}, ${device.clientId}, ${c.kind}, ${c.hash},
                  ${device.scopes as string[]}, ${c.expiresAt})`;
    }
    await this.publishEvents(device);
  }
}
