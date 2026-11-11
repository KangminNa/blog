import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import { schedules } from '../task.schema';
import type { ListSchedulesInput } from './schedule.input';
import { ScheduleListView } from './schedule.view';

// 스케줄 읽기. 주인만 (지시에 비공개 일이 적혀 있을 수 있다).
@Injectable()
export class ScheduleQuery extends BaseQuery {
  /** 공간의 스케줄 (만든 순서). agentId가 있으면 그 에이전트가 담당인 것만 */
  async list(actor: Actor, req: ListSchedulesInput): Promise<ScheduleListView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return new ScheduleListView(
      await this.rows(
        schedules,
        req.agentId === null ? { space_id: spaceId } : { space_id: spaceId, agent_id: req.agentId },
        { order: ['id'] },
      ),
    );
  }
}
