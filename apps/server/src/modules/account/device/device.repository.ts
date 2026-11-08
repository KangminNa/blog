import { Database, NotFound, Rule, TableRepository } from '../../platform';
import { devices, deviceTokens, oauthTokens } from '../account.schema';
import type { DeviceRow } from '../account.tables';
import { Device, DeviceCredential } from './device';

// account.devices + oauth_tokens + device_tokens ↔ Device. 불러오기·잠그기·저장(바뀐 칸만)은 기반이 하고,
// 여기에는 이름·토큰으로 찾는 SQL과 딸린 토큰 표의 저장이 있다. 토큰 표에는 해시만 들어간다.
export class DeviceRepository extends TableRepository<DeviceRow, Device> {
  protected readonly table = devices;
  protected readonly noun = '기기';

  protected toEntity(row: DeviceRow): Device {
    return Device.restore(row);
  }

  /** 이 공간의 기기를 잠근다. 없으면 NotFound */
  override async lock(spaceId: string, id: string): Promise<Device> {
    const device = await this.lockOrNull(spaceId, id);
    if (!device) throw new NotFound('기기를 찾을 수 없어요');
    return device;
  }

  /** 끊지 않은 기기 중에 같은 이름이 있는가 (승인 화면에서 먼저 알려주려고) */
  async nameTaken(spaceId: string, name: string): Promise<boolean> {
    return this.exists(devices, { space_id: spaceId, name: name.trim(), revoked_at: null });
  }

  /** 이름으로 살아 있는 기기를 잠근다 (이름은 살아 있는 기기끼리 겹치지 않는다) */
  async lockLiveByName(spaceId: string, name: string): Promise<Device | null> {
    return this.findOne({ space_id: spaceId, name, revoked_at: null }, { lock: true });
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
    const presented = DeviceCredential.restore(
      DeviceCredential.REFRESH,
      tokenHash,
      row.token_expires_at,
      row.token_revoked_at,
    );
    return Device.restore(row, presented);
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

  /** 그사이 살아 있는 다른 기기가 같은 이름을 차지했으면 사람이 읽을 오류로 */
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
    const revoke = { revoked_at: Rule.now };
    for (const hash of device.retiredHashes) {
      await this.updateRows(oauthTokens, revoke, { token_hash: hash, revoked_at: null });
      await this.updateRows(deviceTokens, revoke, { token_hash: hash, revoked_at: null });
    }
    if (device.retiresDeviceTokens)
      await this.updateRows(deviceTokens, revoke, { device_id: device.id, revoked_at: null });
    if (device.revoked) {
      await this.updateRows(oauthTokens, revoke, { device_id: device.id, revoked_at: null });
      await this.updateRows(deviceTokens, revoke, { device_id: device.id, revoked_at: null });
    }
    await this.insertRows(deviceTokens, device.newDeviceTokens);
    for (const row of device.newOAuthTokens)
      await this.sql`INSERT INTO account.oauth_tokens ${this.sql(row as never)}`;
  }
}
