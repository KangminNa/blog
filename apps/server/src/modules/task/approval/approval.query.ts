import { Injectable } from '@nestjs/common';
import { type Actor, and, BaseQuery, desc, eq, lt, NotFound, QueryTemplate } from '../../platform';
import { approvals } from '../task.schema';
import type { ApprovalRow } from '../task.tables';
import type { ApprovalIdInput, ListApprovalsInput } from './approval.input';
import { ApprovalPageView, ApprovalView } from './approval.view';

// 결재 읽기. 주인만. 결재 화면은 target으로 대상 모듈의 API에서 실제 내용을 읽는다 (AI의 요약을 보여 주지 않는다).
@Injectable()
export class ApprovalQuery extends BaseQuery {
  private static readonly PAGE = 30;
  /** 공간의 결재 한 쪽, 최근 것부터. 상태와 커서(이 id보다 앞)는 있을 때만 거른다. 다음 쪽이 있는지 보려고 하나 더 읽는다 */
  private static readonly PAGE_ROWS = QueryTemplate.choose<
    { space: string | null; status: string | null; cursor: string | null },
    ApprovalRow
  >(['status', 'cursor'], (q, given) =>
    q
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.space_id, QueryTemplate.value('space')),
          given('status') ? eq(approvals.status, QueryTemplate.value('status')) : undefined,
          given('cursor') ? lt(approvals.id, QueryTemplate.value('cursor')) : undefined,
        ),
      )
      .orderBy(desc(approvals.id))
      .limit(ApprovalQuery.PAGE + 1),
  );
  /** 공간의 결재 한 줄 */
  private static readonly ONE = QueryTemplate.of<{ space: string | null; id: string }, ApprovalRow>(
    (q) =>
      q
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.space_id, QueryTemplate.value('space')),
            eq(approvals.id, QueryTemplate.value('id')),
          ),
        ),
  );

  async list(actor: Actor, req: ListApprovalsInput): Promise<ApprovalPageView> {
    actor.assertOwner();
    const rows = await ApprovalQuery.PAGE_ROWS.rows(this.sql, {
      space: actor.spaceId,
      status: req.status,
      cursor: req.cursor,
    });
    const page = rows.slice(0, ApprovalQuery.PAGE);
    return new ApprovalPageView(
      page.map((r) => new ApprovalView(r)),
      rows.length > ApprovalQuery.PAGE ? (page.at(-1)?.id ?? null) : null,
    );
  }

  async get(actor: Actor, req: ApprovalIdInput): Promise<ApprovalView> {
    actor.assertOwner();
    const row = await ApprovalQuery.ONE.one(this.sql, { space: actor.spaceId, id: req.id });
    if (!row) throw new NotFound('결재를 찾을 수 없어요');
    return new ApprovalView(row);
  }
}
