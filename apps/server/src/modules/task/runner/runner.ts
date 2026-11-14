import { TableEntity } from '../../platform';
import type { RunnerNew, RunnerRow } from '../task.tables';
import { RunnerView } from './runner.view';

// 러너 하나의 상태 (task.runners). 러너는 run 권한을 가진 기기이고, 기기의 이름·종류는 account가 가진다.
// 여기서는 일을 받을지(accepting)만 주인이 바꾼다. 줄은 러너가 서버에 처음 닿을 때 생기고(RunnerRepository.seen),
// 마지막으로 닿은 때는 version을 올리지 않고 적는다: 러너가 자주 닿아도 주인의 켜기·끄기가 막히면 안 된다.
export class Runner extends TableEntity<RunnerRow, RunnerNew> {
  /**
   * 마지막으로 닿은 지 이만큼 안이면 연결된 것으로 본다. 러너는 next_jobs로 25초마다, 일하는 동안은 진행 보고로,
   * AI 토큰이 없는 동안은 ai_login으로 길게는 60초마다 닿는다
   */
  static readonly ONLINE_MS = 90_000;

  static restore(row: RunnerRow): Runner {
    return new Runner(row);
  }

  /** 마지막으로 닿은 때가 now에서 ONLINE_MS 안인가 */
  static onlineAt(lastSeenAt: Date, now: Date): boolean {
    return now.getTime() - lastSeenAt.getTime() < Runner.ONLINE_MS;
  }

  /** 코드 러너 칸인가 (기기의 권한 sandbox, 닿을 때마다 서버가 적는다). 칸에는 에이전트를 묶지 않는다 */
  get sandbox(): boolean {
    return this.row.sandbox;
  }

  /** 일 받기를 켜거나 끈다. 끄면 next_jobs가 빈 목록을 돌려주고, 달리던 일은 끝까지 간다. 같으면 그대로 */
  setAccepting(on: boolean): void {
    if (on === this.row.accepting) return;
    this.put('accepting', on);
  }

  /** 바꾼 러너 하나. 지금 하는 일은 목록에서만 (null) */
  view(now: Date): RunnerView {
    return new RunnerView(this.row, Runner.onlineAt(this.row.last_seen_at, now));
  }
}
