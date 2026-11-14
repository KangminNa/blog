import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseService,
  Forbidden,
  Idempotency,
  type Sql,
  SystemActor,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { ChatResult } from '../chat/chat-result.policy';
import { OutputRepository } from '../output/output.repository';
import type { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import { Approval } from './approval';
import type {
  ApprovalResultInput,
  DecideApprovalInput,
  RequestApprovalInput,
} from './approval.input';
import { ApprovalRepository } from './approval.repository';

// 결재 쓰기: 에이전트가 올리고, 주인이 정하고, 실행 결과로 작업을 끝낸다.
// 결재와 작업은 함께 바뀌어야 해서 같은 트랜잭션에서 두 묶음을 쓴다 (객체설계 9장).
// 잠그는 순서는 어디서나 작업 → 결재 → 에이전트.
@Injectable()
export class ApprovalService extends BaseService {
  private static readonly REQUEST = 'request_approval';

  /** 에이전트가 작업 토큰으로 올린다. 작업은 waiting이 된다. 같은 request_id는 처음 결재를 돌려준다 */
  async request(actor: Actor, req: RequestApprovalInput): Promise<Approval> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { spaceId, agentId, taskId } = actor;
    const now = new Date();
    return this.transaction(async (tx) => {
      const approvals = new ApprovalRepository(tx);
      // request_id는 AI가 만든다. 다른 작업에서 같은 값을 써도 앞 결재가 돌아오지 않게 작업마다 센다
      const once = new Idempotency(tx, taskId, req.requestId, ApprovalService.REQUEST);
      const before = await once.previous();
      if (before) return approvals.load(spaceId, String(before.approvalId));
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, taskId);
      const agent = await new AgentRepository(tx).load(spaceId, agentId);
      // 대화의 일이면 결과 카드에 실린다 (2차 2단계): 사람에게 따로 알리지 않는다
      const chatId = await tasks.chatOf(taskId);
      const approval = Approval.request(task, agent, req.fields, now, chatId);
      await tasks.save(task);
      await approvals.save(approval);
      await once.remember({ approvalId: approval.id });
      return approval;
    });
  }

  /** 주인이 정한다. 승인이면 task.approval.granted를 남기고, 실행은 대상을 가진 모듈이 한다 */
  async decide(actor: Actor, req: DecideApprovalInput): Promise<Approval> {
    actor.assertOwner();
    const { spaceId, id: deciderId } = actor;
    if (!spaceId || !deciderId) throw new Forbidden('owner');
    const now = new Date();
    return this.transaction(async (tx) => {
      const seen = await new ApprovalRepository(tx).load(spaceId, req.id);
      if (seen.isCard) return this.decideCard(tx, spaceId, deciderId, req, now);
      seen.assertOwnDecision();
      const { approval, tasks, task } = await this.lockWithTask(tx, spaceId, req.id);
      approval.assertVersion(req.version);
      approval.decide(req.decision, deciderId, req.note, now);
      if (task) {
        approval.applyTo(task, now);
        await tasks.save(task);
      }
      await new ApprovalRepository(tx).save(approval);
      if (approval.raisesLimit) {
        const agents = new AgentRepository(tx);
        const agent = await agents.lock(spaceId, approval.targetId);
        agent.raiseLimit();
        await agents.save(agent);
      }
      return approval;
    });
  }

  /**
   * 다른 모듈이 알린 실행 결과로 작업을 끝낸다. 같은 이벤트가 두 번 와도 결과가 같다.
   * 모르는 결재나 작업이 없는 결재의 결과는 그냥 넘어간다.
   */
  async applyResult(actor: Actor, spaceId: string, req: ApprovalResultInput): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const now = new Date();
    await this.transaction(async (tx) => {
      const seen = await new ApprovalRepository(tx).findIn(spaceId, req.approvalId);
      if (!seen?.approved || seen.taskId === null) return;
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, seen.taskId);
      task.concludeExecution(req.succeeded, req.error, now);
      await tasks.save(task);
    });
  }

  /**
   * 결과 카드의 결정 (2차 2단계). 승인: 고른 결재는 승인(대상을 가진 모듈이 실행), 고르지 않은 결재는 반려,
   * 고르지 않은 결과물은 휴지통으로. 반려: 결과물을 모두 휴지통으로. 수정 요청 · 반려 뒤의 일(회차 멈추기, 다음 회차)은
   * 이벤트를 받은 ChatCardHandler가 한다. 잠그는 순서: 실린 결재의 작업 → 카드 → 실린 결재 → 결과물
   */
  private async decideCard(
    tx: Sql,
    spaceId: string,
    deciderId: string,
    req: DecideApprovalInput,
    now: Date,
  ): Promise<Approval> {
    const approvals = new ApprovalRepository(tx);
    const tasks = new TaskRepository(tx);
    const seen = await approvals.inCard(req.id);
    const held = new Map<string, Task>();
    for (const id of [...new Set(seen.flatMap((a) => (a.taskId ? [a.taskId] : [])))].sort())
      held.set(id, await tasks.lock(spaceId, id));
    const card = await approvals.lock(spaceId, req.id);
    card.assertVersion(req.version);
    const actions: Approval[] = [];
    for (const one of seen) actions.push(await approvals.lock(spaceId, one.id));
    const outputs = new OutputRepository(tx);
    const made = await outputs.lockInCard(card.id);
    const picked = ChatResult.picked(req.picked, [
      ...actions.map((a) => a.id),
      ...made.map((o) => o.id),
    ]);
    card.decide(req.decision, deciderId, req.note, now);
    await approvals.save(card);
    if (card.status === Approval.REVISION_REQUESTED) return card;
    const keep = card.approved;
    for (const action of keep ? actions : []) {
      if (action.status !== Approval.PENDING) continue;
      if (picked.has(action.id)) action.approve(deciderId, null, now);
      else action.reject(deciderId, null, now);
      const task = action.taskId ? held.get(action.taskId) : undefined;
      if (task) {
        action.applyTo(task, now);
        await tasks.save(task);
      }
      await approvals.save(action);
    }
    for (const output of made) {
      if (keep && picked.has(output.id)) continue;
      output.trash(now);
      await outputs.save(output);
    }
    return card;
  }

  /** 잠그기 전에 어느 작업의 결재인지 읽고, 작업 → 결재 순서로 잠근다 */
  private async lockWithTask(tx: Sql, spaceId: string, approvalId: string) {
    const approvals = new ApprovalRepository(tx);
    const tasks = new TaskRepository(tx);
    const seen = await approvals.load(spaceId, approvalId);
    const task = seen.taskId === null ? null : await tasks.lock(spaceId, seen.taskId);
    return { approval: await approvals.lock(spaceId, approvalId), tasks, task };
  }
}
