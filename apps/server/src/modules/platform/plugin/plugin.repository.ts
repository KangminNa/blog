import { BaseRepository } from '../base/base-repository';
import { asc, eq, QueryTemplate } from '../base/query-template';
import { pluginSettings, plugins } from '../platform.schema';
import type { PluginRow, PluginSettingRow } from '../platform.tables';
import { PluginState } from './plugin-state';

// platform.plugins + platform.plugin_settings ↔ PluginState.
// 열쇠가 id가 아니라 이름이고 version 칸이 없어 TableRepository를 쓰지 않는다. 저장은 늘 덮어쓴다.
export class PluginRepository extends BaseRepository<PluginState> {
  /** 플러그인 전부, 이름 순서 */
  private static readonly ALL = QueryTemplate.of<Record<string, never>, PluginRow>((q) =>
    q.select().from(plugins).orderBy(asc(plugins.name)),
  );
  /** 플러그인 전부를 이름 순서로 잠근다 */
  private static readonly LOCK_ALL = QueryTemplate.of<Record<string, never>, PluginRow>((q) =>
    q.select().from(plugins).orderBy(asc(plugins.name)).for('update'),
  );
  /** 이름으로 플러그인 한 줄을 잠근다 */
  private static readonly LOCK_ONE = QueryTemplate.of<{ name: string }, PluginRow>((q) =>
    q
      .select()
      .from(plugins)
      .where(eq(plugins.name, QueryTemplate.value('name')))
      .for('update'),
  );
  /** 플러그인 하나의 설정 */
  private static readonly SETTINGS = QueryTemplate.of<{ plugin: string }, PluginSettingRow>((q) =>
    q
      .select()
      .from(pluginSettings)
      .where(eq(pluginSettings.plugin, QueryTemplate.value('plugin'))),
  );
  /** 모든 플러그인의 설정 */
  private static readonly ALL_SETTINGS = QueryTemplate.of<Record<string, never>, PluginSettingRow>(
    (q) => q.select().from(pluginSettings),
  );

  protected toEntity(row: PluginRow): PluginState {
    return PluginState.restore(row, []);
  }

  async all(): Promise<readonly PluginState[]> {
    return this.withAllSettings(await PluginRepository.ALL.rows(this.sql, {}));
  }

  /** 트랜잭션 안에서 전부 잠그고 읽는다. 끝날 때까지 설정이 바뀌지 않는다 */
  async lockAll(): Promise<readonly PluginState[]> {
    return this.withAllSettings(await PluginRepository.LOCK_ALL.rows(this.sql, {}));
  }

  /** 트랜잭션 안에서 잠그고 읽는다. 없으면 null */
  async lock(name: string): Promise<PluginState | null> {
    const plugin = await PluginRepository.LOCK_ONE.one(this.sql, { name });
    if (!plugin) return null;
    const settings = await PluginRepository.SETTINGS.rows(this.sql, { plugin: name });
    return PluginState.restore(plugin, settings);
  }

  /**
   * 플러그인 행은 늘, 설정은 바뀐 것만 덮어쓴다. by: 바꾼 요청자 (`종류:id`).
   * enabled_at은 처음 켠 때다: 새 행이면 지금, 꺼져 있다 켜면 지금, 켜진 채면 그대로, 끄면 지운다.
   * 읽어 온 행이면 updated_at도 실리지만 덮어쓸 때는 쓰지 않는다 (now()).
   */
  async save(state: PluginState, by: string): Promise<void> {
    const plugin = {
      ...state.unsaved,
      enabled_at: state.enabled ? new Date() : null,
      updated_by: by,
    };
    await this.sql`
      INSERT INTO platform.plugins ${this.sql(plugin as never)}
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
    const settings = await PluginRepository.ALL_SETTINGS.rows(this.sql, {});
    return plugins.map((p) =>
      PluginState.restore(
        p,
        settings.filter((s) => s.plugin === p.name),
      ),
    );
  }
}
