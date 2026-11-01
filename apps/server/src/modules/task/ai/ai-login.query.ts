import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, Database, Forbidden, RuleViolation, SecretBox } from '../../platform';
import { AiLogin } from './ai-login';
import type { AiLoginInput } from './ai-login.input';
import { AiLoginRepository } from './ai-login.repository';
import { AiTokenView, AiToolListView, AiToolView } from './ai-login.view';

// AI 로그인 읽기. 콘솔은 상태만 보고, 토큰은 run 권한을 가진 기기에게만 나간다.
@Injectable()
export class AiLoginQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  /** 넣을 수 있는 도구마다 한 줄. 아직 넣지 않았어도 보낸다. 암호문은 읽지도 않는다 */
  async list(actor: Actor): Promise<AiToolListView> {
    actor.assertOwner();
    const [row] = await this.sql`
      SELECT expires_at, checked_at, last_error FROM task.ai_logins
      WHERE space_id = ${actor.spaceId} AND tool = ${AiLogin.CLAUDE}`;
    if (!row) return new AiToolListView([new AiToolView(AiLogin.CLAUDE, false, null, null, null)]);
    const expiresAt = new Date(row.expires_at);
    return new AiToolListView([
      new AiToolView(
        AiLogin.CLAUDE,
        expiresAt.getTime() > Date.now(),
        expiresAt,
        row.checked_at === null ? null : new Date(row.checked_at),
        row.last_error === null ? null : String(row.last_error),
      ),
    ]);
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
}
