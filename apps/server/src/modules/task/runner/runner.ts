import { TrackedEntity } from '../../platform';

// 러너 하나의 상태 (task.runners). 러너는 run 권한을 가진 기기이고, 기기의 이름·종류는 account가 가진다.
// 여기서는 일을 받을지(accepting)만 주인이 바꾼다. 줄은 러너가 서버에 처음 닿을 때 생기고(RunnerRepository.seen),
// 마지막으로 닿은 때는 version을 올리지 않고 적는다: 러너가 자주 닿아도 주인의 켜기·끄기가 막히면 안 된다.
export class Runner extends TrackedEntity {
  /**
   * 마지막으로 닿은 지 이만큼 안이면 연결된 것으로 본다. 러너는 next_jobs로 25초마다, 일하는 동안은 진행 보고로,
   * AI 토큰이 없는 동안은 ai_login으로 길게는 60초마다 닿는다
   */
  static readonly ONLINE_MS = 90_000;

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    /** 러너 기기 (account, 값으로만) */
    readonly deviceId: string,
    private acceptingValue: boolean,
    readonly lastSeenAt: Date,
  ) {
    super(id, version);
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    deviceId: string,
    accepting: boolean,
    lastSeenAt: Date,
  ): Runner {
    return new Runner(id, version, spaceId, deviceId, accepting, lastSeenAt);
  }

  get accepting(): boolean {
    return this.acceptingValue;
  }

  /** 일 받기를 켜거나 끈다. 끄면 next_jobs가 빈 목록을 돌려주고, 달리던 일은 끝까지 간다. 같으면 그대로 */
  setAccepting(on: boolean): void {
    if (on === this.acceptingValue) return;
    this.acceptingValue = on;
    this.track('accepting', on);
  }

  online(now: Date): boolean {
    return now.getTime() - this.lastSeenAt.getTime() < Runner.ONLINE_MS;
  }
}
