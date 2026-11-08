import { Injectable } from '@nestjs/common';
import {
  Actor,
  and,
  BaseQuery,
  Database,
  desc,
  eq,
  Forbidden,
  inArray,
  QueryTemplate,
  RuleViolation,
  SecretBox,
} from '../../platform';
import { Task } from '../task/task';
import { aiLogins, tasks } from '../task.schema';
import type { AiLoginRow, TaskRow } from '../task.tables';
import { AiLogin } from './ai-login';
import type { AiLoginInput } from './ai-login.input';
import { AiLoginRepository } from './ai-login.repository';
import { AiSigninView, type AiTokenView, AiToolListView, AiToolView } from './ai-login.view';

// AI 로그인 읽기. 콘솔은 상태만 보고, 토큰은 run 권한을 가진 기기에게만 나간다.
@Injectable()
export class AiLoginQuery extends BaseQuery {
  /** 공간의 로그인 상태 (암호문은 읽지 않는다) */
  private static readonly STATUSES = QueryTemplate.of<
    { space: string | null },
    Pick<AiLoginRow, 'tool' | 'expires_at' | 'checked_at' | 'last_error'>
  >((q) =>
    q
      .select({
        tool: aiLogins.tool,
        expires_at: aiLogins.expires_at,
        checked_at: aiLogins.checked_at,
        last_error: aiLogins.last_error,
      })
      .from(aiLogins)
      .where(eq(aiLogins.space_id, QueryTemplate.value('space'))),
  );
  /** 공간의 끝나지 않은 웹 로그인 작업, 최근 것부터 */
  private static readonly SIGNINS = QueryTemplate.of<
    { space: string | null },
    Pick<TaskRow, 'id' | 'status' | 'payload'>
  >((q) =>
    q
      .select({ id: tasks.id, status: tasks.status, payload: tasks.payload })
      .from(tasks)
      .where(
        and(
          eq(tasks.space_id, QueryTemplate.value('space')),
          eq(tasks.kind, Task.AI_SIGNIN),
          inArray(tasks.status, [Task.QUEUED, Task.RUNNING]),
        ),
      )
      .orderBy(desc(tasks.id)),
  );

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
    const logins = await AiLoginQuery.STATUSES.rows(this.sql, { space: actor.spaceId });
    const signins = await AiLoginQuery.SIGNINS.rows(this.sql, { space: actor.spaceId });
    return new AiToolListView(
      AiLogin.TOOLS.map((tool) => {
        const row = logins.find((r) => r.tool === tool) ?? null;
        const signin = signins.find((r) => AiLoginQuery.toolOf(r) === tool);
        const expiresAt = row?.expires_at ?? null;
        return new AiToolView(
          tool,
          row,
          row !== null && (expiresAt === null || expiresAt.getTime() > now.getTime()),
          signin ? new AiSigninView(signin, AiLoginQuery.stepOf(signin)) : null,
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
    const login = await new AiLoginRepository(this.sql).byTool(actor.spaceId, req.tool);
    if (!login)
      throw new RuleViolation('AI 토큰을 아직 넣지 않았어요. 콘솔의 AI 메뉴에서 넣어 주세요');
    return login.tokenView(new Date(), this.box);
  }

  /** 웹 로그인의 도구 (payload.tool) */
  private static toolOf(row: Pick<TaskRow, 'payload'>): unknown {
    return (row.payload as Readonly<Record<string, unknown>> | null)?.tool;
  }

  /** 진행 중인 웹 로그인의 단계. 러너가 아직 받지 않았으면 시작 중이다 */
  private static stepOf(row: Pick<TaskRow, 'status' | 'payload'>): string {
    const step = (row.payload as Readonly<Record<string, unknown>> | null)?.step;
    if (row.status === Task.QUEUED || typeof step !== 'string') return Task.SIGNIN_STARTING;
    return step;
  }
}
