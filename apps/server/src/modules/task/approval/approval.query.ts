import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, NotFound, Rule } from '../../platform';
import { approvals } from '../task.schema';
import type { ApprovalIdInput, ListApprovalsInput } from './approval.input';
import { ApprovalPageView, ApprovalView } from './approval.view';

// 결재 읽기. 주인만. 결재 화면은 target으로 대상 모듈의 API에서 실제 내용을 읽는다 (AI의 요약을 보여 주지 않는다).
@Injectable()
export class ApprovalQuery extends BaseQuery {
  private static readonly PAGE = 30;

  async list(actor: Actor, req: ListApprovalsInput): Promise<ApprovalPageView> {
    actor.assertOwner();
    const rows = await this.rows(
      approvals,
      {
        space_id: actor.requireSpace(),
        status: Rule.maybe(req.status),
        id: Rule.maybe(req.cursor, Rule.before),
      },
      { order: ['id desc'], limit: ApprovalQuery.PAGE + 1 },
    );
    const { items, next } = this.pageOf(rows, ApprovalQuery.PAGE, (last) => last.id);
    return new ApprovalPageView(
      items.map((r) => new ApprovalView(r)),
      next,
    );
  }

  async get(actor: Actor, req: ApprovalIdInput): Promise<ApprovalView> {
    actor.assertOwner();
    const row = await this.row(approvals, { space_id: actor.requireSpace(), id: req.id });
    if (!row) throw new NotFound('결재를 찾을 수 없어요');
    return new ApprovalView(row);
  }
}
