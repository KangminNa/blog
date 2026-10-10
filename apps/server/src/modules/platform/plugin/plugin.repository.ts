import { BaseRepository } from '../base/base-repository';
import type { Row } from '../base/database';
import { SealedSecret } from '../base/secret-box';
import { PluginState, StoredSetting } from './plugin-state';

// platform.plugins + platform.plugin_settings ↔ PluginState
export class PluginRepository extends BaseRepository<PluginState> {
  protected toEntity(row: Row): PluginState {
    return PluginState.restore(
      String(row.name),
      Boolean(row.enabled),
      String(row.version),
      (row.granted_uses as string[]) ?? [],
      new Map(),
    );
  }

  async all(): Promise<readonly PluginState[]> {
    const plugins = await this.sql`SELECT * FROM platform.plugins ORDER BY name`;
    const settings = await this.sql`SELECT * FROM platform.plugin_settings`;
    return plugins.map((p) =>
      this.withSettings(
        p,
        settings.filter((s) => s.plugin === p.name),
      ),
    );
  }

  /** 트랜잭션 안에서 잠그고 읽는다. 없으면 null */
  async lock(name: string): Promise<PluginState | null> {
    const [plugin] = await this.sql`SELECT * FROM platform.plugins WHERE name = ${name} FOR UPDATE`;
    if (!plugin) return null;
    const settings = await this.sql`SELECT * FROM platform.plugin_settings WHERE plugin = ${name}`;
    return this.withSettings(plugin, settings);
  }

  async save(state: PluginState, by: string): Promise<void> {
    await this.sql`
      INSERT INTO platform.plugins (name, enabled, version, granted_uses, enabled_at, updated_by)
      VALUES (${state.name}, ${state.enabled}, ${state.pluginVersion}, ${state.grantedUses as string[]},
              ${state.enabled ? new Date() : null}, ${by})
      ON CONFLICT (name) DO UPDATE SET
        enabled = EXCLUDED.enabled, version = EXCLUDED.version, granted_uses = EXCLUDED.granted_uses,
        enabled_at = CASE WHEN EXCLUDED.enabled AND NOT platform.plugins.enabled THEN now()
                          WHEN EXCLUDED.enabled THEN platform.plugins.enabled_at END,
        updated_at = now(), updated_by = EXCLUDED.updated_by`;
    for (const key of state.changedKeys()) {
      const s = state.storedSetting(key);
      if (!s) {
        await this
          .sql`DELETE FROM platform.plugin_settings WHERE plugin = ${state.name} AND key = ${key}`;
        continue;
      }
      await this.sql`
        INSERT INTO platform.plugin_settings (plugin, key, value, secret_ciphertext, secret_nonce, updated_by)
        VALUES (${state.name}, ${key}, ${s.value}, ${s.sealed?.ciphertext ?? null}, ${s.sealed?.nonce ?? null}, ${by})
        ON CONFLICT (plugin, key) DO UPDATE SET
          value = EXCLUDED.value, secret_ciphertext = EXCLUDED.secret_ciphertext,
          secret_nonce = EXCLUDED.secret_nonce, updated_at = now(), updated_by = EXCLUDED.updated_by`;
    }
    state.markSavedAll();
    await this.publishEvents(state);
  }

  private withSettings(plugin: Row, settings: readonly Row[]): PluginState {
    const stored = new Map(
      settings.map((s) => [
        String(s.key),
        new StoredSetting(
          s.value === null ? null : String(s.value),
          s.secret_ciphertext ? new SealedSecret(s.secret_ciphertext, s.secret_nonce) : null,
        ),
      ]),
    );
    return PluginState.restore(
      String(plugin.name),
      Boolean(plugin.enabled),
      String(plugin.version),
      (plugin.granted_uses as string[]) ?? [],
      stored,
    );
  }
}
