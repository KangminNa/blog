import { TableRepository } from '../../platform';
import { goalRounds, goalRuns } from '../task.schema';
import type { GoalRoundRow, GoalRunRow } from '../task.tables';
import { GoalRound } from './goal-round';
import { GoalRun } from './goal-run';

// task.goal_runs ↔ GoalRun. 불러오기 · 잠그기 · 저장은 기반이 한다.
export class GoalRunRepository extends TableRepository<GoalRunRow, GoalRun> {
  protected readonly table = goalRuns;
  protected readonly noun = '목표 실행';

  protected toEntity(row: GoalRunRow): GoalRun {
    return GoalRun.restore(row);
  }

  /** 같은 requestId로 이미 만든 실행 (응답을 놓쳐 다시 누른 것) */
  findByRequest(spaceId: string, requestId: string): Promise<GoalRun | null> {
    return this.findOne({ space_id: spaceId, request_id: requestId });
  }
}

// task.goal_rounds ↔ GoalRound (추가만, 트리거가 고치기 · 지우기를 막는다).
export class GoalRoundRepository extends TableRepository<GoalRoundRow, GoalRound> {
  protected readonly table = goalRounds;
  protected readonly noun = '회차 보고';

  protected toEntity(row: GoalRoundRow): GoalRound {
    return GoalRound.restore(row);
  }

  /** 그 회차의 보고 (없으면 null) */
  findRound(runId: string, round: number): Promise<GoalRound | null> {
    return this.findOne({ run_id: runId, round });
  }
}
