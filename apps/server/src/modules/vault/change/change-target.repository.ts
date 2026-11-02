import { Conflict, Database, TableRepository } from '../../platform';
import type {
  GraphNode,
  GraphNodeRow,
  NodeDetailRow,
  TargetEntity,
  TargetRow,
} from './change-target';

// 변경 대상의 저장소. 대상은 없을 수 있다: 변경은 없는 대상을 실패가 아니라 missing으로 다룬다.
export abstract class TargetEntityRepository<
  R extends TargetRow,
  E extends TargetEntity<R>,
> extends TableRepository<R, E> {
  /** 고칠 대상을 잠근다 (휴지통 포함). 없으면 null */
  async lockOrNull(spaceId: string, id: string): Promise<E | null> {
    return this.maybeOne(await this.select(spaceId, id, true));
  }
}

// vault.nodes에 행이 있는 표의 저장소: 세션 · wiki · 카테고리. 새 행은 점을 먼저 넣고, 표의 열쇠는 id가 아니라 node_id다.
export abstract class NodeRepository<
  R extends NodeDetailRow,
  E extends TargetEntity<R>,
> extends TargetEntityRepository<R, E> {
  /** vault.nodes.kind */
  protected abstract readonly kind: string;

  /** 휴지통만 오갔으면 바뀐 칸이 없다. 그래도 version은 늘 올린다 */
  override async save(entity: E): Promise<void> {
    if (entity.isNew) await this.insertNode(entity);
    else if (entity.changed) await this.updateNode(entity);
    await this.saveParts(entity);
    await this.publishEvents(entity);
  }

  private async insertNode(entity: E): Promise<void> {
    const { id, ...columns } = entity.unsaved;
    const node = { id, space_id: columns.space_id, kind: this.kind };
    await this.sql`INSERT INTO vault.nodes ${this.sql(node as never)}`;
    const [row] = await this.sql<R[]>`
      INSERT INTO ${this.sql(this.table)} ${this.sql(columns as never)} RETURNING *`;
    entity.saved(row as R);
  }

  private async updateNode(entity: E): Promise<void> {
    const columns = { ...entity.unsaved, version: entity.version + 1 };
    const rows = await this.sql<R[]>`
      UPDATE ${this.sql(this.table)} SET ${this.sql(columns as never)}
      WHERE node_id = ${entity.id} AND version = ${entity.version} RETURNING *`;
    this.expectUpdated(rows.length, entity);
    entity.saved(rows[0] as R);
  }
}

// 휴지통으로 가고 주소가 있는 점의 저장소: wiki · 카테고리.
export abstract class GraphNodeRepository<
  R extends GraphNodeRow,
  E extends GraphNode<R>,
> extends NodeRepository<R, E> {
  /** 공간 안에서 주소가 겹치지 않게 하는 제약의 이름 */
  protected abstract readonly slugKey: string;

  /** 새 점은 여기서 겹치지 않는 주소를 정한다 */
  override async save(node: E): Promise<void> {
    if (node.isNew) node.settleSlug(await this.takenSlugs(node.spaceId, node.slug));
    try {
      await super.save(node);
    } catch (error) {
      if (Database.isUniqueViolation(error, this.slugKey))
        throw new Conflict('이미 쓰는 주소예요 (휴지통 포함)');
      throw error;
    }
  }

  protected override async saveParts(node: E): Promise<void> {
    const trash = node.trashChange;
    if (!trash) return;
    await this.sql`UPDATE vault.nodes SET ${this.sql(trash as never)} WHERE id = ${node.id}`;
    node.trashSaved();
  }

  /** 이 주소이거나 "이 주소-숫자"인 점의 주소들 (휴지통 포함). 주소에는 %·_가 없다 (SlugPolicy) */
  private async takenSlugs(spaceId: string, base: string): Promise<ReadonlySet<string>> {
    const rows = await this.sql<Pick<R, 'slug'>[]>`
      SELECT slug FROM ${this.sql(this.table)}
      WHERE space_id = ${spaceId} AND (slug = ${base} OR slug LIKE ${`${base}-%`})`;
    return new Set(rows.map((r) => r.slug));
  }
}
