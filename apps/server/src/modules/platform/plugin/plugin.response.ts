import { Actor } from '../base/actor';
import type { ActionResult } from '../base/base-action';
import { BaseResponse } from '../base/base-response';
import type { PluginSettingsView, PluginView } from './plugin.query';
import { PluginManifest } from './plugin-manifest';
import type { PluginState } from './plugin-state';

export class PluginListResponse extends BaseResponse {
  private constructor(
    private readonly plugins: readonly PluginView[],
    private readonly forOwner: boolean,
  ) {
    super();
  }

  static of(plugins: readonly PluginView[], actor: Actor): PluginListResponse {
    return new PluginListResponse(plugins, actor.can(Actor.WRITE));
  }

  toJSON(): object {
    return {
      plugins: this.plugins.map((p) => {
        const base = {
          name: p.manifest.name,
          version: p.manifest.version,
          description: p.manifest.description,
          webSlots: [...p.manifest.webSlots.keys()],
        };
        if (!this.forOwner) return base;
        // 주인(관리 화면)에게는 켜짐, 필요한 권한, 설정 칸까지. 비밀값은 채워졌는지만
        return {
          ...base,
          enabled: p.enabled,
          active: p.active,
          uses: [...p.manifest.uses],
          useLabels: [...p.manifest.uses].map((u) => PluginManifest.describeUse(u)),
          needsGrant: p.needsGrant,
          missing: p.missing,
          settings: p.settings.map((s) => ({
            key: s.spec.key,
            label: s.spec.label,
            type: s.spec.type,
            required: s.spec.required,
            help: s.spec.help,
            options: s.spec.options,
            value: s.value,
            isSet: s.isSet,
          })),
          // 관리 동작 (켜져 있고 동작 중일 때만 등록돼 있다)
          actions: p.actions.map((a) => ({ name: a.name, label: a.action.label })),
        };
      }),
    };
  }
}

export class PluginSettingsResponse extends BaseResponse {
  private constructor(private readonly view: PluginSettingsView) {
    super();
  }

  static of(view: PluginSettingsView): PluginSettingsResponse {
    return new PluginSettingsResponse(view);
  }

  toJSON(): object {
    return {
      name: this.view.name,
      ready: this.view.ready,
      settings: Object.fromEntries(this.view.settings),
    };
  }
}

/** 켜기·끄기·설정 저장의 결과. 화면은 이 뒤에 목록을 다시 불러온다 */
export class PluginStateResponse extends BaseResponse {
  private constructor(private readonly state: PluginState) {
    super();
  }

  static of(state: PluginState): PluginStateResponse {
    return new PluginStateResponse(state);
  }

  toJSON(): object {
    return { name: this.state.name, enabled: this.state.enabled };
  }
}

/** 관리 동작의 결과 (예: 연결 확인) */
export class PluginActionResponse extends BaseResponse {
  private constructor(private readonly result: ActionResult) {
    super();
  }

  static of(result: ActionResult): PluginActionResponse {
    return new PluginActionResponse(result);
  }

  toJSON(): object {
    return this.result.toJSON();
  }
}
