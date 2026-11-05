// 플러그인의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 설정 칸 하나 (관리 화면용). 비밀값은 값 대신 채워졌는지만 */
export class PluginSettingView {
  constructor(
    readonly key: string,
    readonly label: string,
    /** text · secret · select · boolean */
    readonly type: string,
    readonly required: boolean,
    readonly help: string,
    readonly options: readonly string[],
    readonly value: string | null,
    readonly isSet: boolean,
  ) {}

  toJSON() {
    return {
      key: this.key,
      label: this.label,
      type: this.type,
      required: this.required,
      help: this.help,
      options: [...this.options],
      value: this.value,
      isSet: this.isSet,
    };
  }
}

/** 관리 동작 하나 (켜져 있고 동작 중일 때만 등록돼 있다) */
export class PluginActionView {
  constructor(
    readonly name: string,
    readonly label: string,
  ) {}

  toJSON() {
    return { name: this.name, label: this.label };
  }
}

/** 플러그인 하나 */
export class PluginView {
  constructor(
    readonly name: string,
    readonly version: string,
    readonly description: string,
    readonly webSlots: readonly string[],
    readonly enabled: boolean,
    readonly active: boolean,
    readonly uses: readonly string[],
    readonly useLabels: readonly string[],
    readonly needsGrant: readonly string[],
    readonly missing: readonly string[],
    readonly settings: readonly PluginSettingView[],
    readonly actions: readonly PluginActionView[],
  ) {}

  /** 방문자: 무엇이 들어 있는지만 */
  toPublicJSON() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      webSlots: [...this.webSlots],
    };
  }

  /** 주인(관리 화면): 켜짐, 필요한 권한, 설정 칸, 관리 동작까지 */
  toJSON() {
    return {
      ...this.toPublicJSON(),
      enabled: this.enabled,
      active: this.active,
      uses: [...this.uses],
      useLabels: [...this.useLabels],
      needsGrant: [...this.needsGrant],
      missing: [...this.missing],
      settings: this.settings.map((s) => s.toJSON()),
      actions: this.actions.map((a) => a.toJSON()),
    };
  }
}

/** 플러그인 목록. 주인용(toJSON)과 방문자용(toPublicJSON) */
export class PluginListView {
  constructor(readonly plugins: readonly PluginView[]) {}

  toJSON() {
    return { plugins: this.plugins.map((p) => p.toJSON()) };
  }

  toPublicJSON() {
    return { plugins: this.plugins.map((p) => p.toPublicJSON()) };
  }
}

/** 웹 화면이 플러그인을 그릴 때 받는 공개 설정 */
export class PluginSettingsView {
  constructor(
    readonly name: string,
    readonly settings: ReadonlyMap<string, string>,
    readonly ready: boolean,
  ) {}

  toJSON() {
    return { name: this.name, ready: this.ready, settings: Object.fromEntries(this.settings) };
  }
}

/** 관리 동작의 결과 (예: 연결 확인) */
export class PluginActionResultView {
  constructor(
    readonly ok: boolean,
    readonly message: string,
    readonly details: readonly string[],
  ) {}

  toJSON() {
    return { ok: this.ok, message: this.message, details: [...this.details] };
  }
}
