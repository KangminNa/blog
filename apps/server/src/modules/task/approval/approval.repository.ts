import { and, eq, QueryTemplate, TableRepository } from '../../platform';
import { approvals } from '../task.schema';
import type { ApprovalRow } from '../task.tables';
import { Approval } from './approval';

// task.approvals ↔ Approval. 불러오기와 저장은 기반이 하고, 여기에는 찾는 SQL만 있다.
export class ApprovalRepository extends TableRepository<ApprovalRow, Approval> {
  /** 작업이 기다리는 결재를 잠근다 (작업 하나에 하나뿐이다) */
  private static readonly LOCK_PENDING = QueryTemplate.of<{ task: string }, ApprovalRow>((q) =>
    q
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.task_id, QueryTemplate.value('task')),
          eq(approvals.status, Approval.PENDING),
        ),
      )
      .for('update'),
  );

  protected readonly table = approvals;
  protected readonly noun = '결재';

  protected toEntity(row: ApprovalRow): Approval {
    return Approval.restore(row);
  }

  /** 있을 수도 없을 수도 있을 때 (다른 모듈의 이벤트가 가리킨 결재) */
  async findIn(spaceId: string, id: string): Promise<Approval | null> {
    return this.maybeOne(await this.select(spaceId, id, false));
  }

  /** 작업이 기다리는 결재 (작업 하나에 하나뿐이다) */
  async lockPending(taskId: string): Promise<Approval | null> {
    return this.maybeOne(await ApprovalRepository.LOCK_PENDING.rows(this.sql, { task: taskId }));
  }
}
