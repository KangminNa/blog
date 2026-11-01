import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, NotFound, type Row } from '../../platform';
import type { ApprovalIdInput, ListApprovalsInput } from './approval.input';
import { ApprovalPageView, ApprovalView } from './approval.view';

// 결재 읽기. 주인만. 결재 화면은 target으로 대상 모듈의 API에서 실제 내용을 읽는다 (AI의 요약을 보여 주지 않는다).
@Injectable()
export class ApprovalQuery extends BaseQuery {
  private static readonly PAGE = 30;

  async list(actor: Actor, req: ListApprovalsInput): Promise<ApprovalPageView> {
    actor.assertOwner();
    const rows = await this.sql`
      SELECT * FROM task.approvals
      WHERE space_id = ${actor.spaceId}
        ${req.status === null ? this.sql`` : this.sql`AND status = ${req.status}`}
        ${req.cursor === null ? this.sql`` : this.sql`AND id < ${req.cursor}`}
      ORDER BY id DESC
      LIMIT ${ApprovalQuery.PAGE + 1}`;
    const page = rows.slice(0, ApprovalQuery.PAGE).map((r) => ApprovalQuery.view(r));
    return new ApprovalPageView(
      page,
      rows.length > ApprovalQuery.PAGE ? (page.at(-1)?.id ?? null) : null,
    );
  }

  async get(actor: Actor, req: ApprovalIdInput): Promise<ApprovalView> {
    actor.assertOwner();
    const [row] = await this.sql`
      SELECT * FROM task.approvals WHERE space_id = ${actor.spaceId} AND id = ${req.id}`;
    if (!row) throw new NotFound('결재를 찾을 수 없어요');
    return ApprovalQuery.view(row);
  }

  private static view(r: Row): ApprovalView {
    return new ApprovalView(
      String(r.id),
      r.task_id === null ? null : String(r.task_id),
      r.agent_id === null ? null : String(r.agent_id),
      String(r.action),
      String(r.target_kind),
      String(r.target_id),
      Number(r.target_version),
      String(r.status),
      r.decided_by === null ? null : String(r.decided_by),
      r.decided_at === null ? null : new Date(r.decided_at),
      r.note === null ? null : String(r.note),
      Number(r.version),
      new Date(r.created_at),
    );
  }
}
