import { TableRepository } from '../../platform';
import { approvals } from '../task.schema';
import type { ApprovalRow } from '../task.tables';
import { Approval } from './approval';

// task.approvals ↔ Approval. 불러오기와 저장은 기반이 하고, 여기에는 찾는 SQL만 있다.
export class ApprovalRepository extends TableRepository<ApprovalRow, Approval> {
  protected readonly table = approvals;
  protected readonly noun = '결재';

  protected toEntity(row: ApprovalRow): Approval {
    return Approval.restore(row);
  }

  /** 있을 수도 없을 수도 있을 때 (다른 모듈의 이벤트가 가리킨 결재) */
  async find(spaceId: string, id: string): Promise<Approval | null> {
    return this.maybeOne(await this.select(spaceId, id, false));
  }

  /** 작업이 기다리는 결재 (작업 하나에 하나뿐이다) */
  async lockPending(taskId: string): Promise<Approval | null> {
    return this.maybeOne(
      await this.sql`
      SELECT * FROM task.approvals WHERE task_id = ${taskId} AND status = ${Approval.PENDING} FOR UPDATE`,
    );
  }
}
