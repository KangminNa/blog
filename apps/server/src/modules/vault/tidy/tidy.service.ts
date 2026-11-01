import { Injectable } from '@nestjs/common';
import { Actor, BaseService, Database, Forbidden } from '../../platform';
import type { SaveTidySettingsInput, SessionSavedInput } from './tidy.input';
import { TidyQuery } from './tidy.query';
import { TidyBacklogView, type TidySettingsView } from './tidy.view';
import { TidySettingsRepository } from './tidy-settings.repository';

// 세션 정리 쓰기: 자동 정리 켜고 끄기(주인), 저장 뒤 자동 요청(일꾼), 쌓인 세션 요청(주인).
// 일을 직접 만들지 않는다: 일 요청 이벤트를 outbox에 남기고, 같은 판은 requestId로 작업 하나가 된다.
@Injectable()
export class TidyService extends BaseService {
  constructor(
    db: Database,
    private readonly query: TidyQuery,
  ) {
    super(db);
  }

  async save(actor: Actor, req: SaveTidySettingsInput): Promise<TidySettingsView> {
    actor.assertOwner();
    const spaceId = TidyService.spaceOf(actor);
    await this.transaction(async (tx) => {
      const settings = new TidySettingsRepository(tx);
      const found = await settings.lock(spaceId, new Date());
      found.assertVersion(req.version);
      found.turn(req.autoTidy, new Date());
      await settings.save(found);
    });
    return this.query.settings(actor);
  }

  /** 세션의 새 판이 저장된 뒤 (일꾼이 부른다). 꺼져 있으면 아무 일도 없다 */
  async saved(actor: Actor, spaceId: string, req: SessionSavedInput): Promise<void> {
    actor.assertCan(Actor.TIDY);
    const session = await this.query.session(actor, spaceId, req.sessionId);
    if (!session) return;
    await this.transaction(async (tx) => {
      const settings = new TidySettingsRepository(tx);
      const found = await settings.lock(spaceId, new Date());
      found.saved(session, req.seq);
      await settings.save(found);
    });
  }

  /** 대표 wiki가 없는 세션을 오래된 순으로 한 묶음 요청한다. 다시 눌러도 같은 판의 작업은 늘지 않는다 */
  async backlog(actor: Actor): Promise<TidyBacklogView> {
    actor.assertOwner();
    const spaceId = TidyService.spaceOf(actor);
    const page = await this.query.backlog(actor);
    await this.transaction(async (tx) => {
      const settings = new TidySettingsRepository(tx);
      const found = await settings.lock(spaceId, new Date());
      found.backlog(page.sessions);
      await settings.save(found);
    });
    return new TidyBacklogView(page.sessions.length, page.total - page.sessions.length);
  }

  private static spaceOf(actor: Actor): string {
    if (!actor.spaceId) throw new Forbidden('owner');
    return actor.spaceId;
  }
}
