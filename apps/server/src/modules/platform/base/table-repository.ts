import type { PgTable } from 'drizzle-orm/pg-core';
import { BaseRepository } from './base-repository';
import type { Row } from './database';
import type { TableEntity, TableRow } from './table-entity';
import { type How, TableQuery, type Where } from './table-query';

/** Service가 아는 저장소의 모양: 잠그고 저장한다 */
export interface EntityStore<E> {
  lock(spaceId: string, id: string): Promise<E>;
  save(entity: E): Promise<void>;
}

// 표 하나가 엔티티 하나인 저장소. 불러오기, 잠그기, 저장은 어느 표나 같아서 여기 한 곳에 있다.
// 하위 클래스는 표(<모듈>.schema.ts)와 행 → 엔티티 한 줄, 그 기능만의 찾기만 가진다.
// 찾기는 코어의 조건 규칙(find · findOne)으로 쓰고, 표를 잇거나 모으면 SQL로 쓴다.
export abstract class TableRepository<R extends TableRow, E extends TableEntity<R>>
  extends BaseRepository<E>
  implements EntityStore<E>
{
  /** 이 저장소의 표 (<모듈>.schema.ts) */
  protected abstract readonly table: PgTable;
  /** 찾지 못했을 때 알리는 이름 */
  protected abstract readonly noun: string;

  /** 없으면 NotFound */
  async load(spaceId: string, id: string): Promise<E> {
    return this.one(await this.select(spaceId, id, false), this.noun);
  }

  /** 고칠 행을 잠근다. 없으면 NotFound */
  async lock(spaceId: string, id: string): Promise<E> {
    return this.one(await this.select(spaceId, id, true), this.noun);
  }

  /** 없을 수도 있는 행을 잠근다 (없는 대상이 실패가 아니라 판단할 거리일 때). 없으면 null */
  async lockOrNull(spaceId: string, id: string): Promise<E | null> {
    return this.maybeOne(await this.select(spaceId, id, true));
  }

  /** 새 행이면 넣고, 아니면 바뀐 칸만 version과 함께 고친다. 그다음 딸린 표와 이벤트 */
  async save(entity: E): Promise<void> {
    if (entity.isNew) await this.insert(entity);
    else if (Object.keys(entity.unsaved).length > 0) await this.update(entity);
    await this.saveParts(entity);
    await this.publishEvents(entity);
  }

  /** 조건에 맞는 엔티티들 (예: this.find({ space_id: s }, { order: ['id'], lock: true })) */
  protected async find(where: Where<R>, how?: How<R>): Promise<E[]> {
    const rows = await TableQuery.of(this.table).rows(this.sql, where, how as How<TableRow>);
    return rows.map((row) => this.toEntity(row));
  }

  /** 조건에 맞는 첫 엔티티. 없으면 null */
  protected async findOne(where: Where<R>, how?: How<R>): Promise<E | null> {
    const [found] = await this.find(where, how);
    return found ?? null;
  }

  /**
   * 한 줄을 공간과 id로 읽는다 (조건 규칙). id · space_id 칸이 없는 표나
   * 다른 표를 함께 읽는 엔티티는 SQL로 바꾼다
   */
  protected select(spaceId: string, id: string, lock: boolean): Promise<readonly Row[]> {
    return TableQuery.of(this.table).rows(this.sql, { id, space_id: spaceId }, { lock });
  }

  /** 함께 저장할 딸린 표 (판, 기록). 없으면 하지 않는다 */
  protected async saveParts(_entity: E): Promise<void> {}

  /** 스키마까지 적은 표 이름 (예: task.goals). 저장 SQL에 쓴다 */
  protected get tableName(): string {
    return TableQuery.of(this.table).name;
  }

  private async insert(entity: E): Promise<void> {
    const [row] = await this.sql<R[]>`
      INSERT INTO ${this.sql(this.tableName)} ${this.sql(entity.unsaved as never)} RETURNING *`;
    entity.saved(row as R);
  }

  private async update(entity: E): Promise<void> {
    const rows = await this.sql<R[]>`
      UPDATE ${this.sql(this.tableName)} SET ${this.sql(entity.unsaved as never)}, version = version + 1
      WHERE id = ${entity.id} AND version = ${entity.version} RETURNING *`;
    this.expectUpdated(rows.length, entity);
    entity.saved(rows[0] as R);
  }
}
