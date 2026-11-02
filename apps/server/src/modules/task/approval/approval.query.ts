import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, NotFound } from '../../platform';
import type { IdInput, ListInput } from '../task/task.input';
import type { ApprovalRow } from '../task.tables';
import { ApprovalPageView, ApprovalView } from './approval.view';

// 결재 읽기. 주인만. 결재 화면은 target으로 대상 모듈의 API에서 실제 내용을 읽는다 (AI의 요약을 보여 주지 않는다).
@Injectable()
export class ApprovalQuery extends BaseQuery {
  private static readonly PAGE = 30;

  async list(actor: Actor, req: ListInput): Promise<ApprovalPageView> {
    actor.assertOwner();
    const rows = await this.sql<ApprovalRow[]>`
      SELECT * FROM task.approvals
      WHERE space_id = ${actor.spaceId}
        ${req.status === null ? this.sql`` : this.sql`AND status = ${req.status}`}
        ${req.cursor === null ? this.sql`` : this.sql`AND id < ${req.cursor}`}
      ORDER BY id DESC
      LIMIT ${ApprovalQuery.PAGE + 1}`;
    const page = rows.slice(0, ApprovalQuery.PAGE);
    return new ApprovalPageView(
      page.map((r) => new ApprovalView(r)),
      rows.length > ApprovalQuery.PAGE ? (page.at(-1)?.id ?? null) : null,
    );
  }

  async get(actor: Actor, req: IdInput): Promise<ApprovalView> {
    actor.assertOwner();
    const [row] = await this.sql<ApprovalRow[]>`
      SELECT * FROM task.approvals WHERE space_id = ${actor.spaceId} AND id = ${req.id}`;
    if (!row) throw new NotFound('결재를 찾을 수 없어요');
    return new ApprovalView(row);
  }
}
