import type { PluginRow } from '../platform.tables';

// 플러그인의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 대부분 표가 아니라 목록 파일(PluginManifest)과 상태(PluginState)에서 계산해 값으로 받는다.
// 보는 사람마다 나눈다: 방문자는 동작 중인 것의 이름과 화면 자리만, 주인(관리 화면)은 켜짐과 설정 칸까지.

/** 설정 칸 하나 (관리 화면용). 비밀값은 값 대신 채워졌는지만 */
export class PluginSettingView {
  constructor(
    private readonly key: string,
    private readonly label: string,
    /** text · secret · select · boolean */
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
      options: [...this.options],
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

/** 방문자가 보는 플러그인 하나: 무엇이 들어 있는지만. 주인에게는 이 칸들이 앞에 온다 */
export class PluginSummaryView {
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
      webSlots: [...this.webSlots],
    };
  }
}

/** 주인(관리 화면)이 보는 플러그인 하나: 켜짐, 필요한 권한, 설정 칸, 관리 동작까지 */
export class PluginView {
  constructor(
    private readonly summary: PluginSummaryView,
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
      ...this.summary.toJSON(),
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

/** 주인이 보는 목록: 들어 있는 플러그인 전부 */
export class PluginListView {
  constructor(private readonly plugins: readonly PluginView[]) {}

  toJSON() {
    return { plugins: this.plugins.map((p) => p.toJSON()) };
  }
}

/** 방문자가 보는 목록: 동작 중인 것만 */
export class PluginSummaryListView {
  constructor(private readonly plugins: readonly PluginSummaryView[]) {}

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
    return { name: this.name, ready: this.ready, settings: Object.fromEntries(this.settings) };
  }
}

/** 켜기·끄기·설정 저장의 결과. 화면은 이 뒤에 목록을 다시 불러온다 */
export class PluginStateView {
  constructor(private readonly row: Readonly<Pick<PluginRow, 'name' | 'enabled'>>) {}

  toJSON() {
    return { name: this.row.name, enabled: this.row.enabled };
  }
}

/** 관리 동작의 결과 (예: 연결 확인) */
export class PluginActionResultView {
  constructor(
    private readonly ok: boolean,
    private readonly message: string,
    private readonly details: readonly string[],
  ) {}

  toJSON() {
    return { ok: this.ok, message: this.message, details: [...this.details] };
  }
}
