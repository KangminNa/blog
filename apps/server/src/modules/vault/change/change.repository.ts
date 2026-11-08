import { TableRepository } from '../../platform';
import { changeSets } from '../vault.schema';
import type { ChangeNew, ChangeOpRow, ChangeRow, ReviewRuleRow } from '../vault.tables';
import { type ChangeOp, ChangeOps, RevertOp, SettledOp } from './change-op';
import { ChangeSet, type LoadedChangeSet } from './change-set';
import type { ChangeTarget, ChangeWork } from './change-target';
import { ReviewRules } from './review.policy';

// vault.change_sets + change_ops + changes(실제로 바뀐 행의 전/후) ↔ ChangeSet. 검토 규칙 값(review_rules)도 여기서 읽는다.
// 머리를 먼저 넣고(begin) 적용이 끝난 뒤 저장하므로(save) 저장의 순서는 기반과 다르다.
export class ChangeRepository extends TableRepository<LoadedChangeSet, ChangeSet> {
  protected readonly table = changeSets;
  protected readonly noun = '변경 묶음';

  protected toEntity(row: LoadedChangeSet): ChangeSet {
    return ChangeSet.restore(
      row,
      (row.ops ?? []).map((op) => ChangeRepository.toOp(op)),
    );
  }

  /** 기다리는 변경만 다시 적용할 수 있게 되살린다. 끝난 변경은 기록이다 */
  private static toOp(row: ChangeOpRow): ChangeOp {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const op =
      row.status === 'waiting'
        ? ChangeOps.waiting(row.op, row.seq, row.target_id, row.base_version, payload)
        : new SettledOp(row.seq, row.op, row.target_kind, row.target_id, row.base_version, payload);
    return op.restored(row);
  }

  /** 묶음 한 줄과 그 안의 변경들 */
  protected override select(spaceId: string, id: string, lock: boolean) {
    return this.sql`
      SELECT s.*, (
        SELECT jsonb_agg(to_jsonb(o) ORDER BY o.seq)
        FROM vault.change_ops o WHERE o.change_set_id = s.id
      ) AS ops
      FROM vault.change_sets s
      WHERE s.id = ${id} AND s.space_id = ${spaceId}
      ${lock ? this.sql`FOR UPDATE OF s` : this.sql``}`;
  }

  /**
   * 이 작업이 이미 낸 묶음. 없으면 null. 같은 작업의 제출이 동시에 와도 하나씩 처리되도록 그 자리를 잠근다
   * (트랜잭션이 끝나면 풀린다): 뒤의 제출은 앞의 묶음을 찾는다.
   */
  async lockJob(spaceId: string, jobId: string): Promise<ChangeSet | null> {
    await this
      .sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vault.change_set.job:${jobId}`}, 0))`;
    const [found] = await this.sql<Pick<LoadedChangeSet, 'id'>[]>`
      SELECT id FROM vault.change_sets WHERE job_id = ${jobId} AND space_id = ${spaceId}`;
    return found ? this.load(spaceId, found.id) : null;
  }

  /** 주인이 고른 규칙 값. targets: 이 묶음이 건드리는 대상 수 */
  async rules(spaceId: string, targets: number): Promise<ReviewRules> {
    const rows = await this.sql<Pick<ReviewRuleRow, 'key' | 'action' | 'value'>[]>`
      SELECT key, action, value FROM vault.review_rules WHERE space_id = ${spaceId}`;
    return new ReviewRules(
      new Map(rows.map((r) => [r.key, r.action])),
      new Map(rows.filter((r) => r.value !== null).map((r) => [r.key, r.value as number])),
      targets,
    );
  }

  /** 묶음의 머리를 먼저 남긴다: 적용하는 동안 판(wiki_revisions)이 이 묶음을 가리킨다 */
  async begin(set: ChangeSet): Promise<void> {
    const [row] = await this.sql<LoadedChangeSet[]>`
      INSERT INTO vault.change_sets ${this.sql(set.unsaved as never)} RETURNING *`;
    set.saved(row as LoadedChangeSet);
  }

  /** 판정·적용이 끝난 뒤의 상태와 변경들. 이번 요청에서 연 묶음은 version을 올리지 않는다 */
  override async save(set: ChangeSet): Promise<void> {
    if (!set.opened) {
      // 검토가 남아 있으면 바뀐 칸이 없다. 그래도 version을 올려 늦게 온 결정이 어긋나게 한다
      const columns = { ...set.unsaved, version: set.version + 1 };
      const rows = await this.sql<LoadedChangeSet[]>`
        UPDATE vault.change_sets SET ${this.sql(columns as never)}
        WHERE id = ${set.id} AND version = ${set.version} RETURNING *`;
      this.expectUpdated(rows.length, set);
      set.saved(rows[0] as LoadedChangeSet);
    } else if (Object.keys(set.unsaved).length > 0) {
      const [row] = await this.sql<LoadedChangeSet[]>`
        UPDATE vault.change_sets SET ${this.sql(set.unsaved as never)}
        WHERE id = ${set.id} RETURNING *`;
      set.saved(row as LoadedChangeSet);
    }
    await this.saveOps(set);
    await this.publishEvents(set);
  }

  /** 판정·결정이 바뀐 변경들. 처음이면 넣고, 있으면 그 칸을 고친다 */
  private async saveOps(set: ChangeSet): Promise<void> {
    const dirty = set.ops.filter((op) => op.dirty);
    if (dirty.length === 0) return;
    await this.sql`
      INSERT INTO vault.change_ops ${this.sql(dirty.map((op) => op.toRow(set.id)) as never)}
      ON CONFLICT (change_set_id, seq) DO UPDATE SET
        target_id = excluded.target_id, base_version = excluded.base_version,
        payload = excluded.payload, verdict = excluded.verdict, rule = excluded.rule,
        status = excluded.status, reason = excluded.reason,
        decided_at = excluded.decided_at, decided_by = excluded.decided_by`;
    for (const op of dirty) op.saved();
  }

  /** 실제로 바뀐 행 하나의 전/후. 되돌리기는 이 기록으로 한다 */
  async record(
    work: ChangeWork,
    op: ChangeOp,
    target: ChangeTarget,
    before: Readonly<Record<string, unknown>> | null,
  ): Promise<void> {
    const change: Omit<ChangeNew, 'id'> = {
      space_id: work.spaceId,
      batch_id: work.setId,
      actor_type: work.actorType,
      actor_id: work.actorId,
      domain: 'vault',
      entity: target.targetKind,
      entity_id: target.id,
      op: op.recordAs(before),
      before,
      after: target.snapshot(),
    };
    await this.sql`INSERT INTO vault.changes ${this.sql(change as never)}`;
  }

  /** 이 묶음이 바꾼 대상을 되돌릴 변경들. 아무것도 바꾸지 않았으면 비어 있다 */
  async revertOps(setId: string): Promise<RevertOp[]> {
    const rows = await this.sql<Pick<ChangeRow, 'entity' | 'entity_id' | 'before' | 'after'>[]>`
      SELECT entity, entity_id, before, after FROM vault.changes
      WHERE batch_id = ${setId} ORDER BY id`;
    return RevertOp.squash(
      rows.map(
        (r, i) =>
          new RevertOp(
            i + 1,
            r.entity,
            r.entity_id,
            Number((r.after as Record<string, unknown>).version),
            r.before as Record<string, unknown> | null,
          ),
      ),
    );
  }

  /** 이 묶음의 기록에 되돌린 묶음을 적는다 (기록은 지우지 않는다) */
  async markUndone(setId: string, revertId: string): Promise<void> {
    await this.sql`UPDATE vault.changes SET undone_by = ${revertId} WHERE batch_id = ${setId}`;
  }
}
