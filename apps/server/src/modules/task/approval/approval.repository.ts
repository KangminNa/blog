import { BaseRepository, type Row } from '../../platform';
import { Approval } from './approval';

// task.approvals ↔ Approval. 고칠 때는 엔티티가 기억한 바뀐 열만 저장한다.
export class ApprovalRepository extends BaseRepository<Approval> {
  protected toEntity(row: Row): Approval {
    return Approval.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      row.task_id === null ? null : String(row.task_id),
      row.agent_id === null ? null : String(row.agent_id),
      String(row.action),
      String(row.target_kind),
      String(row.target_id),
      Number(row.target_version),
      String(row.status),
      row.decided_by === null ? null : String(row.decided_by),
      row.decided_at === null ? null : new Date(row.decided_at),
      row.note === null ? null : String(row.note),
      new Date(row.created_at),
    );
  }

  /** 없으면 NotFound */
  async load(spaceId: string, id: string): Promise<Approval> {
    return this.one(
      await this.sql`SELECT * FROM task.approvals WHERE id = ${id} AND space_id = ${spaceId}`,
      '결재',
    );
  }

  /** 있을 수도 없을 수도 있을 때 (다른 모듈의 이벤트가 가리킨 결재) */
  async find(spaceId: string, id: string): Promise<Approval | null> {
    return this.maybeOne(
      await this.sql`SELECT * FROM task.approvals WHERE id = ${id} AND space_id = ${spaceId}`,
    );
  }

  /** 고칠 결재를 잠근다. 없으면 NotFound */
  async lock(spaceId: string, id: string): Promise<Approval> {
    return this.one(
      await this
        .sql`SELECT * FROM task.approvals WHERE id = ${id} AND space_id = ${spaceId} FOR UPDATE`,
      '결재',
    );
  }

  /** 작업이 기다리는 결재 (작업 하나에 하나뿐이다) */
  async lockPending(taskId: string): Promise<Approval | null> {
    return this.maybeOne(
      await this.sql`
      SELECT * FROM task.approvals WHERE task_id = ${taskId} AND status = ${Approval.PENDING} FOR UPDATE`,
    );
  }

  async save(approval: Approval): Promise<void> {
    if (approval.isNew) {
      await this.sql`
        INSERT INTO task.approvals (id, space_id, task_id, agent_id, action, target_kind, target_id,
          target_version, status, note, created_at)
        VALUES (${approval.id}, ${approval.spaceId}, ${approval.taskId}, ${approval.agentId},
          ${approval.action}, ${approval.targetKind}, ${approval.targetId}, ${approval.targetVersion},
          ${approval.status}, ${approval.note}, ${approval.createdAt})`;
    } else if (approval.changed) {
      const result = await this.sql`
        UPDATE task.approvals SET ${this.sql(approval.changes)}, version = version + 1
        WHERE id = ${approval.id} AND version = ${approval.version}`;
      this.expectUpdated(result.count, approval);
    }
    approval.clearChanges();
    await this.publishEvents(approval);
  }
}
