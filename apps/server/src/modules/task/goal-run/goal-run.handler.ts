import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { Approval } from '../approval/approval';
import { Task } from '../task/task';
import { GoalRunService } from './goal-run.service';

// 목표 실행의 회차를 잇는 두 이벤트. 두 번 받아도 결과가 같다 (실행이 그 회차 · 그 결재를 기다릴 때만 움직인다).
//   task.task.changed: 회차 작업이 끝나면 결재를 올리거나 다음 회차를 연다
//   task.approval.*: 실행의 결재가 정해지면 다음 회차 · 완료 · 멈춤
@Injectable()
export class GoalRunHandler extends BaseHandler {
  static readonly DECIDED: readonly string[] = [
    'task.approval.granted',
    'task.approval.rejected',
    'task.approval.revision_requested',
    'task.approval.cancelled',
  ];
  private static readonly SETTLED: readonly string[] = [Task.DONE, Task.FAILED, Task.CANCELLED];

  constructor(private readonly runs: GoalRunService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.name === Task.CHANGED) {
      if (!GoalRunHandler.SETTLED.includes(String(event.data.status))) return;
      await this.runs.settleRound(new SystemActor(), event.spaceId, String(event.data.taskId));
      return;
    }
    if (event.data.targetKind !== Approval.GOAL_RUN) return;
    await this.runs.decided(new SystemActor(), event.spaceId, String(event.data.approvalId));
  }
}
