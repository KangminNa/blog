import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Conflict, type Sql } from '../../platform';
import type { AgentUsage } from '../agent/agent';
import { AgentRepository } from '../agent/agent.repository';
import { GoalRepository } from '../goal/goal.repository';
import { TaskRepository } from '../task/task.repository';
import { Heartbeat } from './heartbeat';
import type { HeartbeatInput } from './heartbeat.input';
import { HeartbeatRepository } from './heartbeat.repository';

// 하트비트 쓰기: 주인이 에이전트마다 정하고, 일꾼이 1분마다 때가 된 것을 깨워 작업을 만든다.
// 깨우기는 하트비트 → 작업 순서로 쓴다. 작업은 request_id(heartbeat:<에이전트>:<시각>)로 한 번만 생긴다.
@Injectable()
export class HeartbeatService extends BaseService {
  /** 한 번에 깨우는 수. 남은 것은 다음 차례에 */
  private static readonly BATCH = 50;

  /** 주인이 정한다. 처음이면 version 0, 고칠 때는 본 version (다르면 409) */
  async configure(actor: Actor, req: HeartbeatInput): Promise<Heartbeat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    const goalId = req.settings.goal_id ?? null;
    return this.transaction(async (tx) => {
      await new AgentRepository(tx).load(spaceId, req.agentId);
      if (goalId !== null) (await new GoalRepository(tx).load(spaceId, goalId)).assertActive();
      const heartbeats = new HeartbeatRepository(tx);
      const before = await heartbeats.lockByAgent(spaceId, req.agentId);
      if (before) before.assertVersion(req.version);
      else if (req.version !== 0)
        throw new Conflict('하트비트가 아직 없어요. 다시 읽고 version 0으로 보내 주세요');
      const heartbeat = before ?? Heartbeat.open(spaceId, req.agentId, now);
      heartbeat.configure(req.settings, now);
      await heartbeats.save(heartbeat);
      return heartbeat;
    });
  }

  /**
   * 때가 된 하트비트를 깨운다 (일꾼이 1분마다). 다음 시각으로 넘기고, 에이전트가 일을 받을 수 있을 때만 작업을 만든다.
   * 만들지 않는 때: 멈췄거나 한도로 쉬는 에이전트, 앞 하트비트 작업이 아직 끝나지 않음. 만든 작업 수를 돌려준다
   */
  async runDue(actor: Actor): Promise<number> {
    actor.assertOwnerOrSystem();
    const now = new Date();
    return this.transaction(async (tx) => {
      const heartbeats = new HeartbeatRepository(tx);
      const due = await heartbeats.lockDue(now, HeartbeatService.BATCH);
      const usage = new Map<string, readonly AgentUsage[]>();
      let made = 0;
      for (const heartbeat of due) {
        const slot = heartbeat.fire(now);
        await heartbeats.save(heartbeat);
        if (!usage.has(heartbeat.spaceId))
          usage.set(heartbeat.spaceId, await new AgentRepository(tx).usage(heartbeat.spaceId, now));
        const agent = usage.get(heartbeat.spaceId)?.find((u) => u.agent.id === heartbeat.agentId);
        if (!agent?.ready) continue;
        if (await this.wake(tx, heartbeat, slot, now)) made += 1;
      }
      return made;
    });
  }

  /** 하트비트 작업 하나. 앞 하트비트 작업이 끝나지 않았으면 만들지 않는다. 목표가 닫혔으면 목표 없이 */
  private async wake(tx: Sql, heartbeat: Heartbeat, slot: Date, now: Date): Promise<boolean> {
    const tasks = new TaskRepository(tx);
    if (await tasks.hasOpenRequest(heartbeat.agentId, Heartbeat.REQUEST_PREFIX)) return false;
    const goal =
      heartbeat.goalId === null
        ? null
        : await new GoalRepository(tx).load(heartbeat.spaceId, heartbeat.goalId);
    return tasks.insertOnce(heartbeat.wake(slot, goal, now));
  }
}
