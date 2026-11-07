import { BaseRepository } from './base-repository';
import type { TableEntity, TableRow } from './table-entity';

/** Service가 아는 저장소의 모양: 잠그고 저장한다 */
export interface EntityStore<E> {
  lock(spaceId: string, id: string): Promise<E>;
  save(entity: E): Promise<void>;
}

// 표 하나가 엔티티 하나인 저장소. 불러오기, 잠그기, 저장은 어느 표나 같아서 여기 한 곳에 있다.
// 하위 클래스는 표 이름과 행 → 엔티티 한 줄, 그 표만의 SQL만 가진다. 칼럼을 몰라도 된다.
export abstract class TableRepository<R extends TableRow, E extends TableEntity<R>>
  extends BaseRepository<E>
  implements EntityStore<E>
{
  /** 스키마까지 적은 표 이름 */
  protected abstract readonly table: string;
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

  /** 한 줄을 읽는 SQL. 다른 표를 함께 읽는 엔티티가 바꾼다 */
  protected select(spaceId: string, id: string, lock: boolean) {
    return this.sql`
      SELECT * FROM ${this.sql(this.table)} WHERE id = ${id} AND space_id = ${spaceId}
      ${lock ? this.sql`FOR UPDATE` : this.sql``}`;
  }

  /** 함께 저장할 딸린 표 (판, 기록). 없으면 하지 않는다 */
  protected async saveParts(_entity: E): Promise<void> {}

  private async insert(entity: E): Promise<void> {
    const [row] = await this.sql<R[]>`
      INSERT INTO ${this.sql(this.table)} ${this.sql(entity.unsaved as never)} RETURNING *`;
    entity.saved(row as R);
  }

  private async update(entity: E): Promise<void> {
    const rows = await this.sql<R[]>`
      UPDATE ${this.sql(this.table)} SET ${this.sql(entity.unsaved as never)}, version = version + 1
      WHERE id = ${entity.id} AND version = ${entity.version} RETURNING *`;
    this.expectUpdated(rows.length, entity);
    entity.saved(rows[0] as R);
  }
}
