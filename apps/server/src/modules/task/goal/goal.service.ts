import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Forbidden, Idempotency } from '../../platform';
import { Goal } from './goal';
import type { CreateGoalInput, GoalStatusInput, UpdateGoalInput } from './goal.input';
import { GoalRepository } from './goal.repository';

// 목표 쓰기: 만들기, 고치기, 상태 바꾸기. 목표를 정하는 건 주인만 (AI는 목표를 읽기만 한다).
@Injectable()
export class GoalService extends BaseService {
  private static readonly CREATE = 'create_goal';

  /** 같은 requestId가 다시 오면 처음 만든 것을 돌려준다. 부모는 진행 중이어야 한다 */
  async create(actor: Actor, req: CreateGoalInput): Promise<Goal> {
    actor.assertOwner();
    const spaceId = GoalService.spaceOf(actor);
    return this.transaction(async (tx) => {
      const goals = new GoalRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, GoalService.CREATE);
      const before = await once.previous();
      if (before) return goals.load(spaceId, String(before.goalId));
      // 부모를 잠가 두고 만든다: 그사이 부모가 끝나면 끝난 목표 아래에 생긴다
      const parent = req.parentId === null ? null : await goals.lock(spaceId, req.parentId);
      const goal = Goal.open(
        spaceId,
        parent,
        parent ? await goals.depthOf(parent.id) : 0,
        req.title,
        req.description,
        req.sort,
        new Date(),
      );
      await goals.save(goal);
      await once.remember({ goalId: goal.id });
      return goal;
    });
  }

  /** 본 version이 지금과 다르면 409 */
  async update(actor: Actor, req: UpdateGoalInput): Promise<Goal> {
    return this.change(actor, req.id, req.version, (goal) => {
      if (req.title !== null) goal.title = req.title;
      if (req.description !== null) goal.description = req.description;
      if (req.sort !== null) goal.sort = req.sort;
    });
  }

  /** 끝내기 · 그만두기 · 다시 열기. 이어진 작업은 그대로 간다 */
  async changeStatus(actor: Actor, req: GoalStatusInput): Promise<Goal> {
    return this.change(actor, req.id, req.version, (goal) => goal.changeStatus(req.status));
  }

  private async change(
    actor: Actor,
    id: string,
    version: number,
    apply: (goal: Goal) => void,
  ): Promise<Goal> {
    actor.assertOwner();
    const spaceId = GoalService.spaceOf(actor);
    return this.transaction(async (tx) => {
      const goals = new GoalRepository(tx);
      const goal = await goals.lock(spaceId, id);
      goal.assertVersion(version);
      apply(goal);
      await goals.save(goal);
      return goal;
    });
  }

  private static spaceOf(actor: Actor): string {
    if (!actor.spaceId) throw new Forbidden('owner');
    return actor.spaceId;
  }
}
