import { Injectable } from '@nestjs/common';
import type { Actor } from './actor';
import type { BaseEntity } from './base-entity';
import { Database, type Sql } from './database';
import type { EntityStore } from './table-repository';

/** 화면이 본 버전과 함께 온 대상 */
export interface VersionTarget {
  readonly id: string;
  readonly version: number;
}

// 쓰기(C·U·D)의 기반. 트랜잭션은 Service만 연다.
// 순서: 권한 확인 → 트랜잭션 { 불러오기 → 객체에 시키기 → 저장 } → 결과.
// 판단은 Entity·Policy에 두고, 여기서는 순서만 정한다. 다른 Service는 부르지 않는다.
@Injectable()
export abstract class BaseService {
  constructor(protected readonly db: Database) {}

  protected transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}

// 엔티티 하나를 고치는 쓰기의 기반. 순서가 어디나 같다: 잠그기 → 버전 확인 → 엔티티에 시키기 → 저장.
// 하위 클래스는 어떤 저장소를 쓰는지와 엔티티에게 무엇을 시키는지만 적는다.
export abstract class EntityService<E extends BaseEntity> extends BaseService {
  protected abstract store(tx: Sql): EntityStore<E>;

  protected change(
    spaceId: string,
    target: VersionTarget,
    apply: (entity: E) => void | Promise<void>,
  ): Promise<E> {
    return this.transaction(async (tx) => {
      const store = this.store(tx);
      const entity = await store.lock(spaceId, target.id);
      entity.assertVersion(target.version);
      await apply(entity);
      await store.save(entity);
      return entity;
    });
  }

  /** 주인만 고친다 */
  protected changeAsOwner(
    actor: Actor,
    target: VersionTarget,
    apply: (entity: E) => void | Promise<void>,
  ): Promise<E> {
    actor.assertOwner();
    return this.change(actor.requireSpace(), target, apply);
  }
}
