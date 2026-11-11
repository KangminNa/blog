import { Injectable } from '@nestjs/common';
import { BaseJob, SystemActor } from '../../platform';
import { WikiScoreQuery } from './wiki-score.query';
import { WikiScoreService } from './wiki-score.service';

// 6시간마다 공간마다 지울 만한 wiki를 찾아 새 후보만 알린다 (docs/wiki점수.md 7장). 지우지 않는다.
// 두 번 돌아도 같다: 이미 알린 wiki는 기록이 있어 다시 알리지 않는다. 그래서 자주 돌아도 알림이 늘지 않는다.
// 반복 작업은 일꾼이 뜬 뒤 간격만큼 지나야 처음 돈다: 하루 간격이면 하루 안에 다시 띄울 때마다 한 번도 돌지 않는다.
@Injectable()
export class WikiStaleJob extends BaseJob {
  static readonly EVERY_MS = 6 * 60 * 60 * 1000;
  readonly name = 'vault.wiki-stale';

  constructor(
    private readonly scores: WikiScoreQuery,
    private readonly service: WikiScoreService,
  ) {
    super();
  }

  async run(): Promise<void> {
    const system = new SystemActor();
    for (const space of await this.scores.spaces(system)) await this.service.notice(system, space);
  }
}
