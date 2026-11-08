import type { PgTable } from 'drizzle-orm/pg-core';
import type { BaseEntity } from './base-entity';
import type { Row, Sql } from './database';
import { Conflict, NotFound } from './errors';
import { Outbox } from './outbox';
import { type Changes, type RowOf, TableQuery, TableReader, type Where } from './table-query';

// 데이터 묶음 하나를 불러오고·잠그고·저장한다. Service가 트랜잭션 안에서 `new`로 만든다.
// 하위 클래스는 DB 행 ↔ 객체 변환과 그 묶음에만 필요한 SQL을 가진다.
export abstract class BaseRepository<E extends BaseEntity> extends TableReader {
  constructor(protected readonly sql: Sql) {
    super();
  }

  /** DB 행 → 객체 (`E.restore` 호출) */
  protected abstract toEntity(row: Row): E;

  /** 행이 하나 있어야 할 때. 없으면 NotFound */
  protected one(rows: readonly Row[], what: string): E {
    const row = rows[0];
    if (!row) throw new NotFound(`${what}을(를) 찾을 수 없어요`);
    return this.toEntity(row);
  }

  /** 행이 없을 수도 있을 때 */
  protected maybeOne(rows: readonly Row[]): E | null {
    const row = rows[0];
    return row ? this.toEntity(row) : null;
  }

  /**
   * `UPDATE … WHERE id = … AND version = …` 결과를 확인한다.
   * 바뀐 행이 없으면 그사이 다른 쪽이 먼저 저장한 것이므로 Conflict.
   */
  protected expectUpdated(count: number, entity: E): void {
    if (count === 0) throw new Conflict(`다른 곳에서 먼저 바뀌었어요 (${entity.id})`);
    entity.markSaved(entity.version + 1);
  }

  /** 객체에 쌓인 이벤트를 같은 트랜잭션의 outbox에 남긴다. save의 마지막에 부른다 */
  protected async publishEvents(entity: E): Promise<void> {
    await new Outbox(this.sql).publish(entity.pullEvents());
  }

  /** 새 행들을 표에 넣는다 (조건 규칙, 넣을 칸은 행마다 같아야 한다) */
  protected insertRows<T extends PgTable>(
    table: T,
    rows: Partial<RowOf<T>> | readonly Partial<RowOf<T>>[],
  ): Promise<void> {
    return TableQuery.of(table).insert(this.sql, rows);
  }

  /** 조건에 맞는 행들을 고친다 (Rule.now는 DB 시각). 고친 수를 돌려준다 */
  protected updateRows<T extends PgTable>(
    table: T,
    changes: Changes<RowOf<T>>,
    where: Where<RowOf<T>>,
  ): Promise<number> {
    return TableQuery.of(table).update(this.sql, changes, where);
  }

  /** 조건에 맞는 행들을 지운다. 지운 수를 돌려준다 */
  protected deleteRows<T extends PgTable>(table: T, where: Where<RowOf<T>>): Promise<number> {
    return TableQuery.of(table).delete(this.sql, where);
  }
}
