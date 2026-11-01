import { BaseRepository, type Row } from '../../platform';
import { type ChangeOp, ChangeOps, RevertOp, SettledOp } from './change-op';
import { ChangeSet } from './change-set';
import type { ChangeTarget, ChangeWork } from './change-target';
import { ReviewRules } from './review.policy';

// vault.change_sets + change_ops + changes(실제로 바뀐 행의 전/후) ↔ ChangeSet. 검토 규칙 값(review_rules)도 여기서 읽는다.
export class ChangeRepository extends BaseRepository<ChangeSet> {
  protected toEntity(row: Row): ChangeSet {
    const ops = ((row.ops ?? []) as Row[]).map((op) => this.toOp(op));
    return ChangeSet.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      String(row.kind),
      String(row.status),
      String(row.actor_type),
      row.actor_id === null ? null : String(row.actor_id),
      row.job_id === null ? null : String(row.job_id),
      String(row.message),
      ops,
      row.reverted_by === null ? null : String(row.reverted_by),
      new Date(row.created_at),
      row.closed_at === null ? null : new Date(row.closed_at),
    );
  }

  /** 기다리는 변경만 다시 적용할 수 있게 되살린다. 끝난 변경은 기록이다 */
  private toOp(row: Row): ChangeOp {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const seq = Number(row.seq);
    const targetId = row.target_id === null ? null : String(row.target_id);
    const baseVersion = row.base_version === null ? null : Number(row.base_version);
    const status = String(row.status);
    const op =
      status === 'waiting'
        ? ChangeOps.waiting(String(row.op), seq, targetId, baseVersion, payload)
        : new SettledOp(
            seq,
            String(row.op),
            String(row.target_kind),
            targetId,
            baseVersion,
            payload,
          );
    return op.restoreState(
      row.verdict === null ? null : String(row.verdict),
      row.rule === null ? null : String(row.rule),
      status,
      row.reason === null ? null : String(row.reason),
      row.decided_at === null ? null : new Date(row.decided_at),
      row.decided_by === null ? null : String(row.decided_by),
    );
  }

  /** 없으면 NotFound */
  async load(spaceId: string, id: string): Promise<ChangeSet> {
    return this.one(await this.select(spaceId, id, false), '변경 묶음');
  }

  /** 없으면 NotFound */
  async lock(spaceId: string, id: string): Promise<ChangeSet> {
    return this.one(await this.select(spaceId, id, true), '변경 묶음');
  }

  private select(spaceId: string, id: string, forUpdate: boolean) {
    return this.sql`
      SELECT s.*, (
        SELECT jsonb_agg(to_jsonb(o) ORDER BY o.seq)
        FROM vault.change_ops o WHERE o.change_set_id = s.id
      ) AS ops
      FROM vault.change_sets s
      WHERE s.id = ${id} AND s.space_id = ${spaceId}
      ${forUpdate ? this.sql`FOR UPDATE OF s` : this.sql``}`;
  }

  /**
   * 이 작업이 이미 낸 묶음. 없으면 null. 같은 작업의 제출이 동시에 와도 하나씩 처리되도록 그 자리를 잠근다
   * (트랜잭션이 끝나면 풀린다): 뒤의 제출은 앞의 묶음을 찾는다.
   */
  async lockJob(spaceId: string, jobId: string): Promise<ChangeSet | null> {
    await this
      .sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vault.change_set.job:${jobId}`}, 0))`;
    const [found] = await this.sql`
      SELECT id FROM vault.change_sets WHERE job_id = ${jobId} AND space_id = ${spaceId}`;
    return found ? this.load(spaceId, String(found.id)) : null;
  }

  /** 주인이 고른 규칙 값. targets: 이 묶음이 건드리는 대상 수 */
  async rules(spaceId: string, targets: number): Promise<ReviewRules> {
    const rows = await this.sql`
      SELECT key, action, value FROM vault.review_rules WHERE space_id = ${spaceId}`;
    return new ReviewRules(
      new Map(rows.map((r) => [String(r.key), String(r.action)])),
      new Map(rows.filter((r) => r.value !== null).map((r) => [String(r.key), Number(r.value)])),
      targets,
    );
  }

  /** 묶음의 머리를 먼저 남긴다: 적용하는 동안 판(wiki_revisions)이 이 묶음을 가리킨다 */
  async begin(set: ChangeSet): Promise<void> {
    await this.sql`
      INSERT INTO vault.change_sets (id, space_id, kind, status, actor_type, actor_id, job_id, message,
        op_count, created_at, submitted_at)
      VALUES (${set.id}, ${set.spaceId}, ${set.kind}, ${set.status}, ${set.actorType}, ${set.actorId},
        ${set.jobId}, ${set.message}, ${set.ops.length}, ${set.createdAt}, ${set.createdAt})`;
  }

  /** 판정·적용이 끝난 뒤의 상태와 변경들. 새 묶음은 version을 올리지 않는다 */
  async save(set: ChangeSet): Promise<void> {
    if (!set.isNew) {
      // 검토가 남아 있으면 바뀐 열이 없다. 그래도 version을 올려 늦게 온 결정이 어긋나게 한다
      const columns = { ...set.changes, version: set.version + 1 };
      const result = await this.sql`
        UPDATE vault.change_sets SET ${this.sql(columns)}
        WHERE id = ${set.id} AND version = ${set.version}`;
      this.expectUpdated(result.count, set);
    } else if (set.changed) {
      await this.sql`UPDATE vault.change_sets SET ${this.sql(set.changes)} WHERE id = ${set.id}`;
    }
    set.clearChanges();
    await this.saveOps(set);
    await this.publishEvents(set);
  }

  private async saveOps(set: ChangeSet): Promise<void> {
    const dirty = set.ops.filter((op) => op.dirty);
    if (dirty.length === 0) return;
    const rows = dirty.map((op) => ({
      change_set_id: set.id,
      seq: op.seq,
      op: op.name,
      target_kind: op.targetKind,
      target_id: op.targetId,
      base_version: op.baseVersion,
      payload: this.sql.json(op.toPayload() as never),
      verdict: op.verdict,
      rule: op.rule,
      status: op.status,
      reason: op.reason,
      decided_at: op.decidedAt,
      decided_by: op.decidedBy,
    }));
    await this.sql`
      INSERT INTO vault.change_ops ${this.sql(
        rows,
        'change_set_id',
        'seq',
        'op',
        'target_kind',
        'target_id',
        'base_version',
        'payload',
        'verdict',
        'rule',
        'status',
        'reason',
        'decided_at',
        'decided_by',
      )}
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
    await this.sql`
      INSERT INTO vault.changes (space_id, batch_id, actor_type, actor_id, domain, entity, entity_id,
        op, before, after)
      VALUES (${work.spaceId}, ${work.setId}, ${work.actorType}, ${work.actorId}, 'vault',
        ${target.targetKind}, ${target.id}, ${op.recordAs(before)},
        ${before === null ? null : this.sql.json(before as never)},
        ${this.sql.json(target.snapshot() as never)})`;
  }

  /** 이 묶음이 바꾼 대상을 되돌릴 변경들. 아무것도 바꾸지 않았으면 비어 있다 */
  async revertOps(setId: string): Promise<RevertOp[]> {
    const rows = await this.sql`
      SELECT entity, entity_id, before, after FROM vault.changes
      WHERE batch_id = ${setId} ORDER BY id`;
    return RevertOp.squash(
      rows.map(
        (r, i) =>
          new RevertOp(
            i + 1,
            String(r.entity),
            String(r.entity_id),
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
