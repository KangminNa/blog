import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Database } from '../../platform';
import { StaleWikiRepository } from './stale-wiki.repository';
import { WikiScoreQuery } from './wiki-score.query';

// wiki 점수의 쓰기: 지울 만한 wiki 알림. 후보는 트랜잭션 밖에서 읽고(점수 계산), 공간을 잠근 뒤 알린 기록과 맞춘다.
@Injectable()
export class WikiScoreService extends BaseService {
  constructor(
    db: Database,
    private readonly scores: WikiScoreQuery,
  ) {
    super(db);
  }

  /** 공간 하나의 지울 만한 wiki를 알린다 (새로 후보가 된 wiki만). 새로 알린 수. 주인이나 서버 자신만 */
  async notice(actor: Actor, spaceId: string): Promise<number> {
    actor.assertOwnerOrSystem();
    const candidates = await this.scores.staleIn(actor, spaceId);
    return this.transaction(async (tx) => {
      const store = new StaleWikiRepository(tx);
      const stale = await store.lock(spaceId);
      stale.settle(candidates);
      await store.save(stale);
      return stale.noticedNow;
    });
  }
}
