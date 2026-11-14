import { Injectable } from '@nestjs/common';
import { Actor, BaseService, Database, Idempotency, Leases, SensitivePolicy } from '../../platform';
import { ProjectRuleQuery } from '../project/project-rule.query';
import { Session, SessionReceipt } from './session';
import type { NoteWorkInput, SaveSessionInput, SaveTranscriptInput } from './session.input';
import { SessionRepository } from './session.repository';
import { SessionNote } from './session-note';
import { SessionTranscript } from './session-transcript';

// 세션 쓰기: AI 도구의 저장(save_session), 수집 훅 · 확장의 원문(save_transcript), 서버 러너의 노트(save_note).
// 관리 화면 편집(사람 판)·휴지통은 뒤 단계에서 여기에 더한다.
// 세션 저장은 변경 묶음이 아니라 판으로만 남는다 (2026-10-10 결정): 원본이 들어오는 일이라 되돌리기 대상이 아니다.
@Injectable()
export class SessionService extends BaseService {
  private static readonly ACTION = 'save_session';
  private static readonly TRANSCRIPT = 'save_transcript';

  constructor(
    db: Database,
    private readonly sensitive: SensitivePolicy,
    private readonly projects: ProjectRuleQuery,
    private readonly leases: Leases,
  ) {
    super(db);
  }

  /**
   * 원문 받기 (2차 4단계): 같은 요청인지 → 모으지 않는 프로젝트면 쌓지 않음(skipped) → 대화 자리를 잠그고 세션 찾기(없으면 만들기)
   * → 원문 쌓기 · 세션 노트 일 요청(outbox) → 결과 기록. 민감정보와 프로젝트 규칙은 트랜잭션 전에 본다
   */
  async saveTranscript(actor: Actor, req: SaveTranscriptInput): Promise<SessionReceipt> {
    actor.assertCan(Actor.UPLOAD);
    const [spaceId, deviceId] = Session.uploader(actor);
    const transcript = SessionTranscript.scrubbed(req.text, this.sensitive);
    const collects = req.project === null || (await this.projects.collects(actor, req.project));
    return this.transaction(async (tx) => {
      const once = new Idempotency(tx, deviceId, req.requestId, SessionService.TRANSCRIPT);
      const before = await once.previous();
      if (before) return SessionReceipt.replay(before);
      const sessions = new SessionRepository(tx);
      const found = await sessions.lockBySource(spaceId, deviceId, req.tool, req.sourceSessionId);
      if (!collects) return SessionReceipt.skipped(found?.id ?? null, 0);
      const session =
        found ?? Session.open(actor, req.tool, req.sourceSessionId, req.project, req.startedAt);
      const receipt = session.receiveTranscript(transcript, req.title, actor, new Date());
      await sessions.save(session);
      await once.remember(receipt);
      return receipt;
    });
  }

  /**
   * 서버 러너가 쓴 세션 노트 받기: 이 러너가 지금 쥔 세션 노트 일의 세션에만 (platform Leases로 묻는다).
   * 답(JSON)을 노트로 읽고 민감정보를 지운 뒤 원본 판으로 쌓는다. 같은 답이 다시 와도 판은 하나
   */
  async writeNote(actor: Actor, req: NoteWorkInput): Promise<SessionReceipt> {
    actor.assertCan(Actor.RUN);
    const [sessionId, seq] = Session.noteWork(await this.leases.of(actor, req.taskId));
    const note = SessionNote.fromAnswer(req.answer).scrubbedBy(this.sensitive);
    return this.transaction(async (tx) => {
      const sessions = new SessionRepository(tx);
      const session = await sessions.lock(actor.requireSpace(), sessionId);
      const receipt = session.writeNote(note, seq, new Date());
      await sessions.save(session);
      return receipt;
    });
  }

  /**
   * 트랜잭션 하나: 같은 요청인지 확인 → 대화 자리 잠그고 세션 찾기(없으면 만들기) → 판 쌓기 → outbox → 결과 기록.
   * 민감정보는 트랜잭션 전에 지운다 (판은 고칠 수 없으므로 판이 되기 전에).
   */
  async save(actor: Actor, req: SaveSessionInput): Promise<SessionReceipt> {
    actor.assertCan(Actor.UPLOAD);
    const [spaceId, deviceId] = Session.uploader(actor);
    const note = SessionNote.write(req.title, req.tags, req.sections).scrubbedBy(this.sensitive);
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
