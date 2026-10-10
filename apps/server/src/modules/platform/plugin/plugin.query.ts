import { Injectable } from '@nestjs/common';
import { Actor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import { Database } from '../base/database';
import { NotFound } from '../base/errors';
import { PluginRepository } from './plugin.repository';
import type { PluginManifest, PluginSettingSpec } from './plugin-manifest';
import { PluginRegistry } from './plugin-registry';
import type { PluginState } from './plugin-state';

/** 설정 칸 하나 (관리 화면용). 비밀값은 값 대신 채워졌는지만 */
export class PluginSettingView {
  constructor(
    readonly spec: PluginSettingSpec,
    readonly value: string | null,
    readonly isSet: boolean,
  ) {}
}

/** 플러그인 하나 */
export class PluginView {
  constructor(
    readonly manifest: PluginManifest,
    readonly enabled: boolean,
    readonly active: boolean,
    readonly missing: readonly string[],
    readonly needsGrant: readonly string[],
    readonly settings: readonly PluginSettingView[],
  ) {}
}

/** 웹 화면이 플러그인을 그릴 때 받는 공개 설정 */
export class PluginSettingsView {
  constructor(
    readonly name: string,
    readonly settings: ReadonlyMap<string, string>,
    readonly ready: boolean,
  ) {}
}

// 플러그인 목록과 설정. 켜짐·설정은 매번 DB에서 읽는다 (다른 곳에서 바꿔도 바로 보이게).
@Injectable()
export class PluginQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly registry: PluginRegistry,
  ) {
    super(db);
  }

  /** 주인에게는 들어 있는 플러그인 전부, 방문자에게는 동작 중인 것만 */
  async list(actor: Actor): Promise<readonly PluginView[]> {
    const states = new Map((await new PluginRepository(this.sql).all()).map((s) => [s.name, s]));
    return this.registry
      .installed()
      .map((m) => this.view(m, states.get(m.name) ?? null))
      .filter((v) => actor.can(Actor.WRITE) || v.active);
  }

  async publicSettings(_actor: Actor, name: string): Promise<PluginSettingsView> {
    const manifest = this.registry.manifest(name);
    const states = await new PluginRepository(this.sql).all();
    const state = states.find((s) => s.name === name);
    if (!manifest || !state?.isActiveFor(manifest)) {
      throw new NotFound(`켜진 플러그인 중에 ${name}이(가) 없어요`);
    }
    return new PluginSettingsView(
      name,
      state.publicValues(manifest),
      state.missingRequired(manifest).length === 0,
    );
  }

  private view(m: PluginManifest, state: PluginState | null): PluginView {
    const settings = m.settings.map((spec) => {
      const stored = state?.storedSetting(spec.key) ?? null;
      return new PluginSettingView(
        spec,
        spec.isSecret ? null : (stored?.value ?? null),
        stored !== null,
      );
    });
    return new PluginView(
      m,
      state?.enabled ?? false,
      state?.isActiveFor(m) ?? false,
      state ? state.missingRequired(m) : m.settings.filter((s) => s.required).map((s) => s.key),
      state?.enabled ? m.needsGrant(new Set(state.grantedUses)) : [],
      settings,
    );
  }
}
