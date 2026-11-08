import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseService } from '../base/base-service';
import type { ToolAnswer } from '../base/base-tool';
import { Database } from '../base/database';
import { NotFound } from '../base/errors';
import { Work } from '../base/operation';
import { Outbox } from '../base/outbox';
import type { PackageOperation } from './plugin-context';
import { PluginRegistry } from './plugin-registry';

// 기능 패키지의 동작을 돌리는 곳 (REST · MCP 입구가 함께 부른다). 순서는 여기 한 곳에서 지킨다:
// 권한 → 입력 모양 → 일(쓰기면 트랜잭션 하나, 남긴 이벤트는 같은 트랜잭션의 outbox로) → View.
// 동작 중인 패키지(켜졌고 허락한 확장 지점 안)의 동작만 찾는다. 꺼지면 경로 · 도구가 바로 없는 것과 같다.
@Injectable()
export class PackageService extends BaseService {
  constructor(
    db: Database,
    private readonly registry: PluginRegistry,
  ) {
    super(db);
  }

  /** REST: /api/p/<패키지>/<경로>. 경로의 :id 같은 값은 입력에 더한다 */
  call(
    actor: Actor,
    plugin: string,
    method: string,
    path: string,
    raw: object,
  ): Promise<ToolAnswer> {
    const at = this.registry.operationAt(plugin, method, path);
    if (!at) throw new NotFound(`없는 경로예요: ${method} /api/p/${plugin}/${path}`);
    return this.run(actor, at.found, { ...raw, ...at.params });
  }

  /** 동작 하나를 순서대로 돌린다 */
  async run(actor: Actor, found: PackageOperation, raw: unknown): Promise<ToolAnswer> {
    const { operation, manifest } = found;
    operation.check(actor);
    const input = operation.input(raw);
    const emits = (name: string) => manifest.emits(name);
    if (!operation.writes)
      return operation.run(new Work(this.db.sql, manifest.schema, emits), actor, input);
    return this.transaction(async (tx) => {
      const work = new Work(tx, manifest.schema, emits);
      const answer = await operation.run(work, actor, input);
      await new Outbox(tx).publish(work.events);
      return answer;
    });
  }
}
