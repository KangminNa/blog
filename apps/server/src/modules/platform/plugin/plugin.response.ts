import { Actor } from '../base/actor';
import { BaseResponse } from '../base/base-response';
import type { PluginSettingsView, PluginView } from './plugin.query';

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
