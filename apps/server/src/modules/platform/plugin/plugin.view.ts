import type { PluginRow } from '../platform.tables';

// 플러그인의 읽기 모양. 방문자는 이름과 화면 자리만, 주인(관리 화면)은 켜짐과 설정 칸까지 본다.
// 대부분 표가 아니라 목록 파일(PluginManifest)에서 와서 값으로 받는다.

/** 방문자가 보는 플러그인 하나. 주인에게는 이 칸들이 앞에 온다 */
export class PluginView {
  constructor(
    private readonly name: string,
    private readonly version: string,
    private readonly description: string,
    private readonly webSlots: readonly string[],
  ) {}

  toJSON() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      webSlots: this.webSlots,
    };
  }
}

/** 설정 칸 하나 (관리 화면용). 비밀값은 값 대신 채워졌는지만 */
export class PluginSettingView {
  constructor(
    private readonly key: string,
    private readonly label: string,
    private readonly type: string,
    private readonly required: boolean,
    private readonly help: string,
    private readonly options: readonly string[],
    private readonly value: string | null,
    private readonly isSet: boolean,
  ) {}

  toJSON() {
    return {
      key: this.key,
      label: this.label,
      type: this.type,
      required: this.required,
      help: this.help,
      options: this.options,
      value: this.value,
      isSet: this.isSet,
    };
  }
}

/** 관리 동작 하나 (켜져 있고 동작 중일 때만 등록돼 있다) */
export class PluginActionView {
  constructor(
    private readonly name: string,
    private readonly label: string,
  ) {}

  toJSON() {
    return { name: this.name, label: this.label };
  }
}

/** 주인이 보는 플러그인 하나: 켜짐, 필요한 권한, 설정 칸까지 */
export class PluginOwnerView {
  constructor(
    private readonly about: PluginView,
    private readonly enabled: boolean,
    private readonly active: boolean,
    private readonly uses: readonly string[],
    private readonly useLabels: readonly string[],
    private readonly needsGrant: readonly string[],
    private readonly missing: readonly string[],
    private readonly settings: readonly PluginSettingView[],
    private readonly actions: readonly PluginActionView[],
  ) {}

  toJSON() {
    return {
      ...this.about.toJSON(),
      enabled: this.enabled,
      active: this.active,
      uses: this.uses,
      useLabels: this.useLabels,
      needsGrant: this.needsGrant,
      missing: this.missing,
      settings: this.settings.map((s) => s.toJSON()),
      actions: this.actions.map((a) => a.toJSON()),
    };
  }
}

/** 플러그인 목록. 주인에게는 전부, 방문자에게는 동작 중인 것만 */
export class PluginListView {
  constructor(private readonly plugins: readonly (PluginView | PluginOwnerView)[]) {}

  toJSON() {
    return { plugins: this.plugins.map((p) => p.toJSON()) };
  }
}

/** 웹 화면이 플러그인을 그릴 때 받는 공개 설정 */
export class PluginSettingsView {
  constructor(
    private readonly name: string,
    private readonly settings: ReadonlyMap<string, string>,
    private readonly ready: boolean,
  ) {}

  toJSON() {
    return {
      name: this.name,
      ready: this.ready,
      settings: Object.fromEntries(this.settings),
    };
  }
}

/** 켜기·끄기·설정 저장의 결과. 화면은 이 뒤에 목록을 다시 불러온다 */
export class PluginStateView {
  constructor(private readonly row: Pick<PluginRow, 'name' | 'enabled'>) {}

  toJSON() {
    return { name: this.row.name, enabled: this.row.enabled };
  }
}
