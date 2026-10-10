import { Injectable } from '@nestjs/common';
import { Actor } from '../base/actor';
import type { ActionResult } from '../base/base-action';
import { BaseService } from '../base/base-service';
import { Database } from '../base/database';
import { NotFound } from '../base/errors';
import { SecretBox } from '../base/secret-box';
import { PluginRepository } from './plugin.repository';
import type { PluginManifest } from './plugin-manifest';
import { PluginRegistry } from './plugin-registry';
import { PluginState } from './plugin-state';

// 플러그인 켜기·끄기·설정 바꾸기. 주인만. 설치 마법사·관리 화면·명령줄이 모두 이것을 부른다.
// 저장과 함께 platform.plugin.changed 이벤트가 남고, 일꾼이 받아 재시작 없이 다시 등록한다.
@Injectable()
export class PluginService extends BaseService {
  constructor(
    db: Database,
    private readonly registry: PluginRegistry,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  /** 켠다. 목록 파일이 쓰는 확장 지점(uses)을 이 순간 허락한 것으로 기록한다 */
  async enable(actor: Actor, name: string): Promise<PluginState> {
    return this.change(actor, name, (state, manifest) => state.enable(manifest));
  }

  async disable(actor: Actor, name: string): Promise<PluginState> {
    return this.change(actor, name, (state) => state.disable());
  }

  /** 설정 값 하나. 빈 문자열이면 지운다. 비밀값은 암호화해서만 저장된다 */
  async set(actor: Actor, name: string, key: string, value: string): Promise<PluginState> {
    return this.change(actor, name, (state, manifest) => {
      const spec = manifest.setting(key);
      if (!spec) throw new NotFound(`${name}에 ${key} 설정이 없어요`);
      state.set(spec, value.trim(), this.box);
    });
  }

  /** 여러 설정을 한 번에 (설치 마법사·관리 화면의 저장 버튼). 하나라도 틀리면 아무것도 바뀌지 않는다 */
  async configure(
    actor: Actor,
    name: string,
    values: ReadonlyMap<string, string>,
  ): Promise<PluginState> {
    return this.change(actor, name, (state, manifest) => {
      for (const [key, value] of values) {
        const spec = manifest.setting(key);
        if (!spec) throw new NotFound(`${name}에 ${key} 설정이 없어요`);
        state.set(spec, value.trim(), this.box);
      }
    });
  }

  /** 관리 동작 (예: 연결 확인). 외부를 부를 수 있어 트랜잭션 밖에서 돈다 */
  async runAction(actor: Actor, name: string, action: string): Promise<ActionResult> {
    actor.assertCan(Actor.WRITE);
    const found = this.registry.action(name, action);
    if (!found)
      throw new NotFound(`${name}에 ${action} 동작이 없어요 (켜져 있고 설정이 끝났는지 확인)`);
    return found.action.run(actor);
  }

  private async change(
    actor: Actor,
    name: string,
    apply: (state: PluginState, manifest: PluginManifest) => void,
  ): Promise<PluginState> {
    actor.assertCan(Actor.WRITE);
    const manifest = this.registry.manifest(name);
    if (!manifest) throw new NotFound(`들어 있는 플러그인 중에 ${name}이(가) 없어요`);
    const state = await this.transaction(async (tx) => {
      const plugins = new PluginRepository(tx);
      const current = (await plugins.lock(name)) ?? PluginState.open(manifest);
      apply(current, manifest);
      await plugins.save(current, `${actor.kind}:${actor.id ?? ''}`);
      return current;
    });
    await this.registry.reload();
    return state;
  }
}
