import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery } from '../../platform';
import { Approval } from '../approval/approval';
import { ChatRequest } from '../chat/chat-request.policy';
import { ChatUpdates } from '../chat/chat-update.policy';
import { Task } from '../task/task';
import { type InboxApprovalRow, type InboxQuestionRow, InboxView } from './inbox.view';

// 나를 기다리는 것 (MCP inbox, 권한 inbox, 2차 4단계): 결재 화면 목록과 같은 결재(대화의 결재는 빼고 결과 카드)와,
// 맡을 에이전트를 물어 답을 기다리는 대화(맡기 전이고 배정 일이 돌지 않는 것). 읽기만 한다
@Injectable()
export class InboxQuery extends BaseQuery {
  /** 수 말고 함께 보이는 최근 것 */
  private static readonly ITEMS = 5;

  async inbox(actor: Actor): Promise<InboxView> {
    actor.assertCan(Actor.INBOX);
    const spaceId = actor.requireSpace();
    const approvals = await this.sql<(InboxApprovalRow & { total: number })[]>`
      SELECT a.id, a.action, a.note, a.target_id, a.created_at,
             coalesce(t.title, c.title) AS title, count(*) OVER ()::int AS total
      FROM task.approvals a
      LEFT JOIN task.tasks t ON t.id = a.task_id
      LEFT JOIN task.chats c ON a.action = ${Approval.CARD} AND c.id = a.target_id
      WHERE a.space_id = ${spaceId} AND a.chat_id IS NULL AND a.status = ${Approval.PENDING}
      ORDER BY a.id DESC LIMIT ${InboxQuery.ITEMS}`;
    const questions = await this.sql<(InboxQuestionRow & { total: number })[]>`
      SELECT c.id, c.title, c.updated_at, count(*) OVER ()::int AS total,
             (SELECT u.text FROM task.chat_updates u
              WHERE u.chat_id = c.id AND u.kind = ${ChatUpdates.QUESTION} ORDER BY u.n DESC LIMIT 1) AS question
      FROM task.chats c
      WHERE c.space_id = ${spaceId} AND c.agent_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM task.tasks r WHERE r.space_id = c.space_id
          AND r.request_id LIKE ${ChatRequest.ROUTE_PREFIX} || c.id || ':%'
          AND r.status = ANY(${[Task.QUEUED, Task.RUNNING]}::text[]))
      ORDER BY c.updated_at DESC LIMIT ${InboxQuery.ITEMS}`;
    return new InboxView(
      approvals,
      approvals[0]?.total ?? 0,
      questions,
      questions[0]?.total ?? 0,
      Approval.CARD,
    );
  }
}
