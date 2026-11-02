import { Database, NotFound, TableRepository } from '../../platform';
import type { DeviceRow } from '../account.tables';
import { Device, DeviceCredential } from './device';

// account.devices + oauth_tokens + device_tokens ↔ Device
export class DeviceRepository extends TableRepository<DeviceRow, Device> {
  protected readonly table = 'account.devices';
  protected readonly noun = '기기';

  protected toEntity(row: DeviceRow): Device {
    return Device.restore(row);
  }

  /** 끊지 않은 기기 중에 같은 이름이 있는가 (승인 화면에서 먼저 알려주려고) */
  async nameTaken(spaceId: string, name: string): Promise<boolean> {
    const [row] = await this.sql`
      SELECT 1 FROM account.devices
      WHERE space_id = ${spaceId} AND name = ${name.trim()} AND revoked_at IS NULL`;
    return Boolean(row);
  }

  /** 트랜잭션 안에서 잠그고 읽는다. 없으면 null */
  async lockIfExists(spaceId: string, id: string): Promise<Device | null> {
    return this.maybeOne(await this.select(spaceId, id, true));
  }

  override async lock(spaceId: string, id: string): Promise<Device> {
    const device = await this.lockIfExists(spaceId, id);
    if (!device) throw new NotFound('기기를 찾을 수 없어요');
    return device;
  }

  /** 갱신 토큰으로 기기를 찾아 잠근다 (이미 무효인 토큰도 찾는다: 재사용 감지) */
  async lockByRefresh(tokenHash: string): Promise<Device | null> {
    const [row] = await this.sql<
      (DeviceRow & { token_expires_at: Date; token_revoked_at: Date | null })[]
    >`
      SELECT d.*, t.expires_at AS token_expires_at, t.revoked_at AS token_revoked_at
      FROM account.oauth_tokens t JOIN account.devices d ON d.id = t.device_id
      WHERE t.token_hash = ${tokenHash} AND t.kind = 'refresh'
      FOR UPDATE OF d`;
    if (!row) return null;
    return Device.restore(
      row,
      DeviceCredential.restore(
        DeviceCredential.REFRESH,
        tokenHash,
        row.token_expires_at,
        row.token_revoked_at,
      ),
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

  override async save(device: Device): Promise<void> {
    try {
      await super.save(device);
    } catch (error) {
      if (Database.isUniqueViolation(error, 'devices_live_name')) throw device.nameTaken();
      throw error;
    }
  }

  /** 토큰을 무효로 하고(끊은 기기는 모두) 새 토큰을 넣는다 */
  protected override async saveParts(device: Device): Promise<void> {
    for (const hash of device.retiredHashes) {
      await this.sql`
        UPDATE account.oauth_tokens SET revoked_at = now()
        WHERE token_hash = ${hash} AND revoked_at IS NULL`;
      await this.sql`
        UPDATE account.device_tokens SET revoked_at = now()
        WHERE token_hash = ${hash} AND revoked_at IS NULL`;
    }
    if (device.revoked) {
      await this.sql`
        UPDATE account.oauth_tokens SET revoked_at = now()
        WHERE device_id = ${device.id} AND revoked_at IS NULL`;
      await this.sql`
        UPDATE account.device_tokens SET revoked_at = now()
        WHERE device_id = ${device.id} AND revoked_at IS NULL`;
    }
    for (const row of device.newDeviceTokens)
      await this.sql`INSERT INTO account.device_tokens ${this.sql(row as never)}`;
    for (const row of device.newOAuthTokens)
      await this.sql`INSERT INTO account.oauth_tokens ${this.sql(row as never)}`;
  }
}
