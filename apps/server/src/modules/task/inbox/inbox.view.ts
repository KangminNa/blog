import type { ApprovalRow, ChatRow } from '../task.tables';

/** 기다리는 결재 한 줄: 결재와 그 결재를 올린 작업의 제목 (결과 카드는 대화의 제목) */
export interface InboxApprovalRow
  extends Pick<ApprovalRow, 'id' | 'action' | 'note' | 'target_id' | 'created_at'> {
  title: string | null;
}

/** 답을 기다리는 질문 한 줄: 맡을 에이전트를 묻는 대화와 마지막 질문 */
export interface InboxQuestionRow extends Pick<ChatRow, 'id' | 'title' | 'updated_at'> {
  question: string | null;
}

/**
 * inbox의 답 (브라우저 확장의 배지, 2차 4단계): 기다리는 결재 · 질문의 수와 최근 것 몇 개.
 * 주소(link)는 콘솔 안의 경로다 (확장이 블로그 주소에 붙여 연다). 결재는 콘솔에서만 한다
 */
export class InboxView {
  constructor(
    private readonly approvals: readonly InboxApprovalRow[],
    private readonly approvalCount: number,
    private readonly questions: readonly InboxQuestionRow[],
    private readonly questionCount: number,
    /** 결과 카드의 동작 (대화로 가는 주소) */
    private readonly cardAction: string,
  ) {}

  toJSON() {
    return {
      total: this.approvalCount + this.questionCount,
      approvals: {
        count: this.approvalCount,
        items: this.approvals.map((a) => ({
          id: a.id,
          action: a.action,
          title: a.title ?? a.note ?? a.action,
          created_at: a.created_at.toISOString(),
          link:
            a.action === this.cardAction
              ? `/admin/chats/${a.target_id}`
              : `/admin/approvals/${a.id}`,
        })),
      },
      questions: {
        count: this.questionCount,
        items: this.questions.map((q) => ({
          chat_id: q.id,
          title: q.title,
          question: q.question,
          updated_at: q.updated_at.toISOString(),
          link: `/admin/chats/${q.id}`,
        })),
      },
    };
  }
}
