import { Injectable } from '@nestjs/common';
import { type Actor, EntityService, Idempotency, type Sql } from '../../platform';
import { Goal } from './goal';
import type { CreateGoalInput, GoalStatusInput, UpdateGoalInput } from './goal.input';
import { GoalRepository } from './goal.repository';

// 목표 쓰기: 만들기, 고치기, 상태 바꾸기. 목표를 정하는 건 주인만 (AI는 목표를 읽기만 한다).
@Injectable()
export class GoalService extends EntityService<Goal> {
  private static readonly CREATE = 'create_goal';

  protected store(tx: Sql): GoalRepository {
    return new GoalRepository(tx);
  }

  /** 같은 requestId가 다시 오면 처음 만든 것을 돌려준다. 부모는 진행 중이어야 한다 */
  async create(actor: Actor, req: CreateGoalInput): Promise<Goal> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const goals = new GoalRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, GoalService.CREATE);
      const before = await once.previous();
      if (before) return goals.load(spaceId, String(before.goalId));
      // 부모를 잠가 두고 만든다: 그사이 부모가 끝나면 끝난 목표 아래에 생긴다
      const parent = req.parentId === null ? null : await goals.lock(spaceId, req.parentId);
      const depth = parent ? await goals.depthOf(parent.id) : 0;
      const goal = Goal.open(spaceId, parent, depth, req.fields, new Date());
      await goals.save(goal);
      await once.remember({ goalId: goal.id });
      return goal;
    });
  }

  /** 본 version이 지금과 다르면 409 */
  update(actor: Actor, req: UpdateGoalInput): Promise<Goal> {
    return this.changeAsOwner(actor, req, (goal) => goal.edit(req.changes));
  }

  /** 끝내기 · 그만두기 · 다시 열기. 이어진 작업은 그대로 간다 */
  changeStatus(actor: Actor, req: GoalStatusInput): Promise<Goal> {
    return this.changeAsOwner(actor, req, (goal) => goal.changeStatus(req.status));
  }
}
