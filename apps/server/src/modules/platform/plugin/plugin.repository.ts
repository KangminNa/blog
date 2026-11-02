import { BaseRepository } from '../base/base-repository';
import type { PluginRow, PluginSettingRow } from '../platform.tables';
import { PluginState } from './plugin-state';

// platform.plugins + platform.plugin_settings ↔ PluginState. 표에 id·version이 없어 BaseRepository를 그대로 쓴다.
export class PluginRepository extends BaseRepository<PluginState> {
  protected toEntity(row: PluginRow): PluginState {
    return PluginState.restore(row, []);
  }

  async all(): Promise<readonly PluginState[]> {
    return this.withAllSettings(
      await this.sql<PluginRow[]>`SELECT * FROM platform.plugins ORDER BY name`,
    );
  }

  /** 트랜잭션 안에서 전부 잠그고 읽는다. 끝날 때까지 설정이 바뀌지 않는다 */
  async lockAll(): Promise<readonly PluginState[]> {
    return this.withAllSettings(
      await this.sql<PluginRow[]>`SELECT * FROM platform.plugins ORDER BY name FOR UPDATE`,
    );
  }

  /** 트랜잭션 안에서 잠그고 읽는다. 없으면 null */
  async lock(name: string): Promise<PluginState | null> {
    const [plugin] = await this.sql<PluginRow[]>`
      SELECT * FROM platform.plugins WHERE name = ${name} FOR UPDATE`;
    if (!plugin) return null;
    const settings = await this.sql<PluginSettingRow[]>`
      SELECT * FROM platform.plugin_settings WHERE plugin = ${name}`;
    return PluginState.restore(plugin, settings);
  }

  async save(state: PluginState, by: string): Promise<void> {
    const row = {
      ...state.unsaved,
      enabled_at: state.enabled ? new Date() : null,
      updated_by: by,
    };
    await this.sql`
      INSERT INTO platform.plugins ${this.sql(row as never)}
      ON CONFLICT (name) DO UPDATE SET
        enabled = EXCLUDED.enabled, version = EXCLUDED.version, granted_uses = EXCLUDED.granted_uses,
        enabled_at = CASE WHEN EXCLUDED.enabled AND NOT platform.plugins.enabled THEN now()
                          WHEN EXCLUDED.enabled THEN platform.plugins.enabled_at END,
        updated_at = now(), updated_by = EXCLUDED.updated_by`;
    for (const key of state.changedKeys()) {
      const setting = state.storedSetting(key);
      if (!setting) {
        await this
          .sql`DELETE FROM platform.plugin_settings WHERE plugin = ${state.name} AND key = ${key}`;
        continue;
      }
      await this.sql`
        INSERT INTO platform.plugin_settings ${this.sql({ ...setting, updated_by: by } as never)}
        ON CONFLICT (plugin, key) DO UPDATE SET
          value = EXCLUDED.value, secret_ciphertext = EXCLUDED.secret_ciphertext,
          secret_nonce = EXCLUDED.secret_nonce, updated_at = now(), updated_by = EXCLUDED.updated_by`;
    }
    state.markSavedAll();
    await this.publishEvents(state);
  }

  private async withAllSettings(plugins: readonly PluginRow[]): Promise<readonly PluginState[]> {
    const settings = await this.sql<PluginSettingRow[]>`SELECT * FROM platform.plugin_settings`;
    return plugins.map((p) =>
      PluginState.restore(
        p,
        settings.filter((s) => s.plugin === p.name),
      ),
    );
  }
}
