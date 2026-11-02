import { Injectable } from '@nestjs/common';
import { Actor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import { Database } from '../base/database';
import { NotFound } from '../base/errors';
import { PluginRepository } from './plugin.repository';
import {
  PluginActionView,
  PluginListView,
  PluginOwnerView,
  PluginSettingsView,
} from './plugin.view';
import { PluginManifest } from './plugin-manifest';
import { PluginRegistry } from './plugin-registry';
import type { PluginState } from './plugin-state';

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
  async list(actor: Actor): Promise<PluginListView> {
    const states = new Map((await new PluginRepository(this.sql).all()).map((s) => [s.name, s]));
    const installed = this.registry.installed();
    if (actor.can(Actor.WRITE))
      return new PluginListView(
        installed.map((m) => this.ownerView(m, states.get(m.name) ?? null)),
      );
    const active = installed.filter((m) => states.get(m.name)?.isActiveFor(m));
    return new PluginListView(active.map((m) => m.view()));
  }

  async publicSettings(_actor: Actor, name: string): Promise<PluginSettingsView> {
    const manifest = this.registry.manifest(name);
    const states = await new PluginRepository(this.sql).all();
    const state = states.find((s) => s.name === name);
    if (!manifest || !state?.isActiveFor(manifest)) {
      throw new NotFound(`켜지 않은 플러그인이에요: ${name}`);
    }
    return new PluginSettingsView(
      name,
      state.publicValues(manifest),
      state.missingRequired(manifest).length === 0,
    );
  }

  private ownerView(m: PluginManifest, state: PluginState | null): PluginOwnerView {
    const uses = [...m.uses];
    return new PluginOwnerView(
      m.view(),
      state?.enabled ?? false,
      state?.isActiveFor(m) ?? false,
      uses,
      uses.map((u) => PluginManifest.describeUse(u)),
      state?.enabled ? m.needsGrant(new Set(state.grantedUses)) : [],
      state ? state.missingRequired(m) : m.settings.filter((s) => s.required).map((s) => s.key),
      m.settings.map((spec) => {
        const stored = state?.storedSetting(spec.key) ?? null;
        return spec.view(spec.isSecret ? null : (stored?.value ?? null), stored !== null);
      }),
      this.registry
        .actions()
        .filter((a) => a.plugin === m.name)
        .map((a) => new PluginActionView(a.name, a.action.label)),
    );
  }
}
