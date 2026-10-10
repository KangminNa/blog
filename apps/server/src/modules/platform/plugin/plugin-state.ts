import { BaseEntity } from '../base/base-entity';
import { RuleViolation } from '../base/errors';
import { DomainEvent } from '../base/event';
import { SealedSecret, type SecretBox } from '../base/secret-box';
import type { PluginManifest, PluginSettingSpec } from './plugin-manifest';

/** 플랫폼 전체에 걸친 이벤트의 공간 id (특정 블로그 공간이 아닌 일) */
const PLATFORM_SPACE = '00000000-0000-0000-0000-000000000000';

/** 저장된 설정 값 하나. 비밀값은 암호화된 채로만 들고 있다 */
export class StoredSetting {
  constructor(
    readonly value: string | null,
    readonly sealed: SealedSecret | null,
  ) {}
}

// 플러그인 하나의 켜짐·허락·설정. 켜기·끄기·설정 바꾸기의 규칙을 지킨다.
// 바뀌면 platform.plugin.changed 이벤트를 남겨, 서버·일꾼이 재시작 없이 다시 읽게 한다.
export class PluginState extends BaseEntity {
  private readonly changed = new Set<string>();
  private announced = false;

  private constructor(
    readonly name: string,
    private enabledFlag: boolean,
    private enabledVersion: string,
    private granted: Set<string>,
    private readonly stored: Map<string, StoredSetting>,
    private isNew: boolean,
  ) {
    super(name, 1);
  }

  static open(manifest: PluginManifest): PluginState {
    return new PluginState(manifest.name, false, manifest.version, new Set(), new Map(), true);
  }

  static restore(
    name: string,
    enabled: boolean,
    version: string,
    granted: readonly string[],
    stored: ReadonlyMap<string, StoredSetting>,
  ): PluginState {
    return new PluginState(name, enabled, version, new Set(granted), new Map(stored), false);
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  get pluginVersion(): string {
    return this.enabledVersion;
  }

  get grantedUses(): readonly string[] {
    return [...this.granted];
  }

  get needsInsert(): boolean {
    return this.isNew;
  }

  /** 저장해야 할 설정 이름들 (값이 바뀌었거나 지워진 것) */
  changedKeys(): readonly string[] {
    return [...this.changed];
  }

  storedSetting(key: string): StoredSetting | null {
    return this.stored.get(key) ?? null;
  }

  /** 켠다. 목록 파일이 쓰는 확장 지점을 지금 허락한다 (켜는 사람이 목록을 보고 결정한 것) */
  enable(manifest: PluginManifest): void {
    this.enabledFlag = true;
    this.enabledVersion = manifest.version;
    this.granted = new Set(manifest.uses);
    this.touched();
  }

  disable(): void {
    this.enabledFlag = false;
    this.touched();
  }

  /** 값을 넣는다. 비밀값은 바로 암호화하고, 빈 값이면 지운다 */
  set(spec: PluginSettingSpec, value: string, box: SecretBox): void {
    const problem = spec.problemWith(value);
    if (problem) throw new RuleViolation(problem);
    if (value === '') this.stored.delete(spec.key);
    else if (spec.isSecret) this.stored.set(spec.key, new StoredSetting(null, box.seal(value)));
    else this.stored.set(spec.key, new StoredSetting(value, null));
    this.changed.add(spec.key);
    this.touched();
  }

  /** 지금 동작해야 하는가: 켜져 있고, 새 버전이 허락받지 않은 확장 지점을 쓰지 않음 */
  isActiveFor(manifest: PluginManifest): boolean {
    return this.enabledFlag && manifest.needsGrant(this.granted).length === 0;
  }

  /** 플러그인 코드에 넘길 값 (기본값 적용, 비밀값 풀기) */
  resolve(manifest: PluginManifest, box: SecretBox): ReadonlyMap<string, string> {
    return new Map(
      manifest.settings.map((spec) => {
        const s = this.stored.get(spec.key);
        if (!s) return [spec.key, spec.defaultValue];
        return [spec.key, s.sealed ? box.open(s.sealed) : (s.value ?? '')];
      }),
    );
  }

  /** 웹으로 내려가도 되는 값만 */
  publicValues(manifest: PluginManifest): ReadonlyMap<string, string> {
    return new Map(
      manifest.settings
        .filter((spec) => spec.isPublic)
        .map((spec) => [spec.key, this.stored.get(spec.key)?.value ?? spec.defaultValue]),
    );
  }

  /** 필수인데 비어 있는 설정 이름 */
  missingRequired(manifest: PluginManifest): readonly string[] {
    return manifest.settings
      .filter((spec) => spec.required && !this.stored.has(spec.key) && spec.defaultValue === '')
      .map((spec) => spec.key);
  }

  markSavedAll(): void {
    this.isNew = false;
    this.changed.clear();
  }

  /** 한 번 저장에 이벤트는 하나만 */
  private touched(): void {
    if (this.announced) return;
    this.announced = true;
    this.record(
      new DomainEvent('platform.plugin.changed', 1, PLATFORM_SPACE, { plugin: this.name }),
    );
  }
}
