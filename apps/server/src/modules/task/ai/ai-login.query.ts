import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseQuery,
  Database,
  Forbidden,
  type Row,
  RuleViolation,
  SecretBox,
} from '../../platform';
import { Task } from '../task/task';
import { AiLogin } from './ai-login';
import type { AiLoginInput } from './ai-login.input';
import { AiLoginRepository } from './ai-login.repository';
import { AiSigninView, AiTokenView, AiToolListView, AiToolView } from './ai-login.view';

// AI 로그인 읽기. 콘솔은 상태만 보고, 토큰은 run 권한을 가진 기기에게만 나간다.
@Injectable()
export class AiLoginQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  /** 로그인을 받는 도구마다 한 줄. 아직 넣지 않았어도 보낸다. 진행 중인 웹 로그인을 함께 싣는다. 암호문은 읽지도 않는다 */
  async list(actor: Actor): Promise<AiToolListView> {
    actor.assertOwner();
    const now = new Date();
    const logins = await this.sql`
      SELECT tool, expires_at, checked_at, last_error FROM task.ai_logins
      WHERE space_id = ${actor.spaceId}`;
    const signins = await this.sql`
      SELECT id, status, payload FROM task.tasks
      WHERE space_id = ${actor.spaceId} AND kind = ${Task.AI_SIGNIN}
        AND status IN (${Task.QUEUED}, ${Task.RUNNING})
      ORDER BY id DESC`;
    return new AiToolListView(
      AiLogin.TOOLS.map((tool) => {
        const row = logins.find((r) => r.tool === tool);
        const signin = signins.find((r) => (r.payload as Row | null)?.tool === tool);
        const expiresAt = row?.expires_at ? new Date(row.expires_at) : null;
        return new AiToolView(
          tool,
          row !== undefined && (expiresAt === null || expiresAt.getTime() > now.getTime()),
          expiresAt,
          row?.checked_at ? new Date(row.checked_at) : null,
          row?.last_error ? String(row.last_error) : null,
          signin ? AiLoginQuery.signin(signin) : null,
        );
      }),
    );
  }

  /**
   * 러너에게 건넬 토큰. 작업 토큰에는 run이 들어갈 수 없지만, 이 값은 권한 이름 하나에만 맡기지 않고 기기인지도 본다:
   * AI가 지시문에 속아도 자기 로그인을 꺼내 가지 못하게.
   */
  async token(actor: Actor, req: AiLoginInput): Promise<AiTokenView> {
    actor.assertCan(Actor.RUN);
    if (actor.kind !== 'device' || !actor.spaceId) throw new Forbidden(Actor.RUN);
    const login = await new AiLoginRepository(this.sql).find(actor.spaceId, req.tool);
    if (!login)
      throw new RuleViolation('AI 토큰을 아직 넣지 않았어요. 콘솔의 AI 메뉴에서 넣어 주세요');
    return new AiTokenView(login.tokenAt(new Date(), this.box), login.expiresAt);
  }

  /** 진행 중인 웹 로그인. 러너가 아직 받지 않았으면 시작 중이다 */
  private static signin(row: Row): AiSigninView {
    const payload = (row.payload as Row | null) ?? {};
    const text = (v: unknown) => (typeof v === 'string' ? v : null);
    return new AiSigninView(
      String(row.id),
      row.status === Task.QUEUED
        ? Task.SIGNIN_STARTING
        : (text(payload.step) ?? Task.SIGNIN_STARTING),
      text(payload.url),
      text(payload.userCode),
    );
  }
}
