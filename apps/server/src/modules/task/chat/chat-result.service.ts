import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Database, Forbidden, SystemActor } from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { OutputRepository } from '../output/output.repository';
import { SkillQuery } from '../skill/skill.query';
import { TaskRepository } from '../task/task.repository';
import { ChatRepository } from './chat.repository';
import { ChatResult } from './chat-result.policy';

// 결과 결재 (2차 2단계 · 기획서 결정 2026-11-14): 대화의 일이 바뀔 때마다(작업 상태 · 결재 요청) 회차가 가라앉았는지 보고
// 다음 하나를 한다: 받을 것이 없으면 다시 맡김(result-check) · 검토자 짝의 검토(result-review) · 결과 카드.
// 카드 · 실린 결재 · 결과물은 함께 바뀌어야 해서 같은 트랜잭션에서 여러 묶음을 쓴다 (ApprovalService와 같은 까닭).
// 대화를 먼저 잠가 같은 대화의 판단은 하나씩 한다. 잠그는 순서: 대화 → 결재 → 결과물.
// 카드의 결정(고른 것만 남기기)은 ApprovalService.decide, 수정 요청 · 반려 뒤의 정리는 ChatService.closeByCard
@Injectable()
export class ChatResultService extends BaseService {
  constructor(
    db: Database,
    private readonly skills: SkillQuery,
  ) {
    super(db);
  }

  /** 작업 하나가 바뀌었다. 대화의 일이 아니면 아무것도 하지 않는다. 두 번 불려도 같다 (카드는 대화마다 하나, 일은 request_id로 하나) */
  async settle(actor: Actor, spaceId: string, taskId: string): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const chatId = await this.transaction((tx) => new TaskRepository(tx).chatOf(taskId));
    if (chatId === null) return;
    const prompts = await this.skills.prompts(actor, spaceId);
    const now = new Date();
    await this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const chat = await chats.lock(spaceId, chatId);
      if (await chats.busy(chat)) return;
      const approvals = new ApprovalRepository(tx);
      const outputs = new OutputRepository(tx);
      const actions = await approvals.lockUncarded(chat.id);
      const made = await outputs.uncardedInChat(spaceId, chat.id);
      const turn = await chats.turnState(chat);
      const previous = await chats.previousTurns(chat, spaceId);
      const agents = await new AgentRepository(tx).all(spaceId);
      const partner = agents.find((a) => a.id === chat.agentId);
      const reviewer = agents.find((a) => a.id === partner?.reviewerId && !a.deleted) ?? null;
      const missing = ChatResult.missing(
        chat.deliver,
        actions.map((a) => a.action),
        made.map((o) => o.name),
      );
      const step = ChatResult.next(
        turn.status,
        actions.length + made.length,
        missing !== null,
        ChatResult.fixesIn(previous),
        reviewer !== null,
        turn.review_status !== null,
      );
      const tasks = new TaskRepository(tx);
      if (step === ChatResult.FIX && partner && missing) {
        const message = prompts.fill('result-check', {
          deliver: missing,
          need: ChatResult.needOf(missing),
        });
        const task = chat.fix(partner, message, previous, now);
        await chats.save(chat);
        await tasks.insertOnce(task);
      } else if (step === ChatResult.REVIEW && reviewer) {
        const items = [...actions.map((a) => a.action), ...made.map((o) => o.name)];
        const instruction = prompts.fill('result-review', {
          goal: chat.goal,
          message: turn.instruction ?? '',
          answer: ChatResult.textOf(turn.result) || '-',
          items: items.map((name) => `- ${name}`).join('\n') || null,
        });
        await tasks.insertOnce(chat.review(reviewer, instruction, now));
      } else if (step === ChatResult.CARD) {
        const open = await approvals.lockOpenCard(chat.id);
        const card = open ?? Approval.forChat(spaceId, chat.id, chat.agentId, chat.turns, now);
        if (open) open.grew(chat.turns);
        await approvals.save(card);
        for (const action of actions) {
          action.bundleInto(card);
          await approvals.save(action);
        }
        for (const output of made) {
          output.bundleInto(card.id);
          await outputs.save(output);
        }
      }
    });
  }
}
