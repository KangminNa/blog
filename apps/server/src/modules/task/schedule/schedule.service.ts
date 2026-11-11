import { Injectable } from '@nestjs/common';
import {
  type Actor,
  EntityService,
  Idempotency,
  type Sql,
  type VersionInput,
} from '../../platform';
import type { AgentUsage } from '../agent/agent';
import { AgentRepository } from '../agent/agent.repository';
import { GoalRepository } from '../goal/goal.repository';
import type { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import type { ScheduleRow } from '../task.tables';
import { Schedule } from './schedule';
import type { CreateScheduleInput, UpdateScheduleInput } from './schedule.input';
import { ScheduleRepository } from './schedule.repository';

// 스케줄 쓰기: 주인이 만들고 · 고치고 · 지우고 · 지금 한 번 돌리고, 일꾼이 1분마다 때가 된 것을 돌려 작업을 만든다.
// 돌리기는 스케줄 → 작업 순서로 쓴다. 작업은 request_id(schedule:<스케줄>:<시각>)로 한 번만 생긴다.
@Injectable()
export class ScheduleService extends EntityService<Schedule> {
  /** 한 번에 돌리는 수. 남은 것은 다음 차례에 */
  private static readonly BATCH = 50;
  private static readonly CREATE = 'schedule.create';

  protected store(tx: Sql): ScheduleRepository {
    return new ScheduleRepository(tx);
  }

  async create(actor: Actor, req: CreateScheduleInput): Promise<Schedule> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const schedules = new ScheduleRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, ScheduleService.CREATE);
      const before = await once.previous();
      if (before) return schedules.load(spaceId, String(before.scheduleId));
      await this.assertRefs(tx, spaceId, req.settings);
      const schedule = Schedule.open(spaceId, req.settings, now);
      await schedules.save(schedule);
      await once.remember({ scheduleId: schedule.id });
      return schedule;
    });
  }

  async update(actor: Actor, req: UpdateScheduleInput): Promise<Schedule> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const schedules = new ScheduleRepository(tx);
      const schedule = await schedules.lock(spaceId, req.id);
      schedule.assertVersion(req.version);
      await this.assertRefs(tx, spaceId, req.settings);
      schedule.configure(req.settings, new Date());
      await schedules.save(schedule);
      return schedule;
    });
  }

  async remove(actor: Actor, req: VersionInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const schedules = new ScheduleRepository(tx);
      const schedule = await schedules.lock(spaceId, req.id);
      schedule.assertVersion(req.version);
      await schedules.remove(schedule);
    });
  }

  /**
   * 주인이 누른 "지금 한 번": 하루 한도에 함께 센다. 앞 작업이 안 끝났어도 만든다 (사람이 고른 것이라).
   * 같은 순간을 두 번 누르면 시각이 달라 작업 둘이 된다 (version이 막는다)
   */
  async runNow(actor: Actor, req: VersionInput): Promise<Task> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const schedules = new ScheduleRepository(tx);
      const schedule = await schedules.lock(spaceId, req.id);
      schedule.assertVersion(req.version);
      const slot = schedule.runNow(now);
      await schedules.save(schedule);
      const task = schedule.wake(slot, await this.goalOf(tx, schedule), now);
      await new TaskRepository(tx).insertOnce(task);
      return task;
    });
  }

  /**
   * 때가 된 스케줄을 돌린다 (일꾼이 1분마다). 다음 시각으로 넘기고, 작업을 만들 수 있을 때만 만든다.
   * 만들지 않는 때: 담당이 멈췄거나 한도로 쉼, 앞 작업이 아직 끝나지 않음, 하루 한도에 닿음. 만든 작업 수를 돌려준다
   */
  async runDue(actor: Actor): Promise<number> {
    actor.assertOwnerOrSystem();
    const now = new Date();
    return this.transaction(async (tx) => {
      const schedules = new ScheduleRepository(tx);
      const tasks = new TaskRepository(tx);
      const due = await schedules.lockDue(now, ScheduleService.BATCH);
      const usage = new Map<string, readonly AgentUsage[]>();
      let made = 0;
      for (const schedule of due) {
        const slot = schedule.fire(now);
        const { agentId, spaceId } = schedule;
        if (agentId !== null) {
          if (!usage.has(spaceId))
            usage.set(spaceId, await new AgentRepository(tx).usage(spaceId, now));
          const agent = usage.get(spaceId)?.find((u) => u.agent.id === agentId);
          if (!agent?.ready) {
            await schedules.save(schedule);
            continue;
          }
        }
        if (await tasks.hasOpenRequest(spaceId, schedule.requestPrefix)) {
          await schedules.save(schedule);
          continue;
        }
        const allowed = schedule.claimRun(now);
        await schedules.save(schedule);
        if (!allowed) continue;
        if (await tasks.insertOnce(schedule.wake(slot, await this.goalOf(tx, schedule), now)))
          made += 1;
      }
      return made;
    });
  }

  /** 담당 에이전트와 목표가 이 공간에 있는가. 목표는 진행 중이어야 한다 */
  private async assertRefs(tx: Sql, spaceId: string, settings: Partial<ScheduleRow>) {
    if (settings.agent_id) await new AgentRepository(tx).load(spaceId, settings.agent_id);
    if (settings.goal_id)
      (await new GoalRepository(tx).load(spaceId, settings.goal_id)).assertActive();
  }

  /** 작업이 향할 목표. 닫혔으면 wake가 목표 없이 만든다 */
  private goalOf(tx: Sql, schedule: Schedule) {
    return schedule.goalId === null
      ? Promise.resolve(null)
      : new GoalRepository(tx).load(schedule.spaceId, schedule.goalId);
  }
}
