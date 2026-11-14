import { BaseRequest, RuleViolation } from '../../platform';
import { ChatUpdates } from './chat-update.policy';

// 대화의 소식 도구 입력의 모양 (docs/API설계.md 4장). 뜻(대화의 일인지, 한도)은 Chat · Service가 본다.

/** MCP agent_updates { chat_id?, project?, after?, wait_seconds? } */
export class AgentUpdatesInput extends BaseRequest {
  static readonly WAIT_MAX = 25;
  /** 커서의 끝 (bigint identity. JS 정수로 다룰 수 있는 범위) */
  private static readonly CURSOR_MAX = Number.MAX_SAFE_INTEGER;

  private constructor(
    readonly chatId: string | null,
    /** git 주소 그대로 (ChatProject가 맞춘다) */
    readonly project: string | null,
    readonly after: number | null,
    readonly waitSeconds: number,
  ) {
    super();
  }

  static from(raw: unknown): AgentUpdatesInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    const after = body.after;
    // 잘못된 커서는 모양 오류(400)가 아니라 규칙 위반(422): 훅이 지난 커서를 그대로 보내는 경우와 같게 다룬다
    if (
      after !== undefined &&
      after !== null &&
      (!Number.isSafeInteger(after) || Number(after) < 0)
    )
      throw new RuleViolation('커서는 0 이상의 정수예요 (지난 답의 cursor)');
    return BaseRequest.read(
      raw,
      (f) =>
        new AgentUpdatesInput(
          body.chat_id === undefined || body.chat_id === null ? null : f.uuid('chat_id'),
          f.optionalText('project', 400),
          f.optionalInteger('after', 0, AgentUpdatesInput.CURSOR_MAX),
          f.optionalInteger('wait_seconds', 0, AgentUpdatesInput.WAIT_MAX) ?? 0,
        ),
    );
  }
}

/** MCP post_update { kind, text } (작업 토큰) */
export class PostUpdateInput extends BaseRequest {
  private constructor(
    readonly kind: string,
    readonly text: string,
  ) {
    super();
  }

  static from(raw: unknown): PostUpdateInput {
    return BaseRequest.read(
      raw,
      (f) => new PostUpdateInput(f.text('kind', 40), f.text('text', ChatUpdates.TEXT_MAX)),
    );
  }
}
