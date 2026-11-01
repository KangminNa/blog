import { Injectable } from '@nestjs/common';
import { Actor, BaseService, Database, Forbidden } from '../../platform';
import { SessionRepository } from '../session/session.repository';
import type { SaveTidySettingsInput, SessionSavedInput } from './tidy.input';
import { TidyQuery } from './tidy.query';
import { TidyBacklogView, type TidySessionView, type TidySettingsView } from './tidy.view';
import { TidySettingsRepository } from './tidy-settings.repository';

// 세션 정리 쓰기: 자동 정리 켜고 끄기(주인), 저장 뒤 자동 요청(일꾼), 쌓인 세션 요청(주인).
// 일을 직접 만들지 않는다: 일 요청 이벤트를 outbox에 남기고, 같은 판은 requestId로 작업 하나가 된다.
// 요청한 판은 같은 트랜잭션에서 세션에 적는다 (`tidy_requested_seq`). 이미 적힌 판은 다시 요청하지 않는다.
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
      if (!found.autoTidy) return;
      if (!(await new SessionRepository(tx).noteTidyRequested(session.id, req.seq))) return;
      found.saved(session, req.seq);
      await settings.save(found);
    });
  }

  /**
   * 지금 판의 정리를 요청하지 않은 세션을 오래된 순으로 한 묶음 요청한다. 다시 누르면 다음 묶음으로 넘어간다.
   * 동시에 눌러도 세션마다 먼저 적은 쪽만 요청한다. 잠그는 순서는 설정 → 세션(id 순).
   */
  async backlog(actor: Actor): Promise<TidyBacklogView> {
    actor.assertOwner();
    const spaceId = TidyService.spaceOf(actor);
    const page = await this.query.backlog(actor);
    const requested = await this.transaction(async (tx) => {
      const settings = new TidySettingsRepository(tx);
      const sessions = new SessionRepository(tx);
      const found = await settings.lock(spaceId, new Date());
      const fresh: TidySessionView[] = [];
      for (const session of page)
        if (await sessions.noteTidyRequested(session.id, session.seq)) fresh.push(session);
      found.backlog(fresh);
      await settings.save(found);
      return fresh.length;
    });
    return new TidyBacklogView(requested, await this.query.remaining(actor));
  }

  private static spaceOf(actor: Actor): string {
    if (!actor.spaceId) throw new Forbidden('owner');
    return actor.spaceId;
  }
}
