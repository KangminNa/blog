import { Injectable } from '@nestjs/common';
import { Actor, BaseService, Database, Idempotency } from '../../platform';
import type { SaveSessionRequest } from './save-session.request';
import { SensitivePolicy } from './sensitive.policy';
import { Session, SessionReceipt } from './session';
import { SessionRepository } from './session.repository';
import { SessionNote } from './session-note';

// 세션 쓰기. 지금은 AI 도구의 저장(save_session) 하나. 관리 화면 편집(사람 판)·휴지통은 뒤 단계에서 여기에 더한다.
// 세션 저장은 변경 묶음이 아니라 판으로만 남는다 (2026-10-10 결정): 원본이 들어오는 일이라 되돌리기 대상이 아니다.
@Injectable()
export class SessionService extends BaseService {
  private static readonly ACTION = 'save_session';

  constructor(
    db: Database,
    private readonly sensitive: SensitivePolicy,
  ) {
    super(db);
  }

  /**
   * 트랜잭션 하나: 같은 요청인지 확인 → 대화 자리 잠그고 세션 찾기(없으면 만들기) → 판 쌓기 → outbox → 결과 기록.
   * 민감정보는 트랜잭션 전에 지운다 (판은 고칠 수 없으므로 판이 되기 전에).
   */
  async save(actor: Actor, req: SaveSessionRequest): Promise<SessionReceipt> {
    actor.assertCan(Actor.UPLOAD);
    const [spaceId, deviceId] = Session.uploader(actor);
    const note = this.sensitive.clean(SessionNote.write(req.title, req.tags, req.sections));
    return this.transaction(async (tx) => {
      const once = new Idempotency(tx, deviceId, req.requestId, SessionService.ACTION);
      const before = await once.previous();
      if (before) return SessionReceipt.replay(before);
      const sessions = new SessionRepository(tx);
      const session =
        (await sessions.lockBySource(spaceId, deviceId, req.tool, req.sourceSessionId)) ??
        Session.open(actor, req.tool, req.sourceSessionId, req.project, req.startedAt);
      const receipt = session.receive(note, actor, new Date());
      await sessions.save(session);
      await once.remember(receipt);
      return receipt;
    });
  }
}
