import { BaseRequest } from '../../platform';
import { Chat } from './chat';

// 대화 입력의 모양. 뜻(상대가 관리자 바로 아래인지, 답을 기다리는 중인지)은 Chat이 검사한다.

/** POST /api/chats { requestId, agentId, message }. 대화와 첫 메시지를 함께. 같은 requestId는 처음 만든 대화 */
export class CreateChatInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly agentId: string,
    readonly message: string,
  ) {
    super();
  }

  static from(raw: unknown): CreateChatInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new CreateChatInput(
          f.text('requestId', 200),
          f.uuid('agentId'),
          f.text('message', Chat.MESSAGE_MAX),
        ),
    );
  }
}

/** POST /api/chats/:id/messages { requestId, version, message }. 같은 requestId는 한 번만 보낸다 */
export class SendChatInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly requestId: string,
    readonly version: number,
    readonly message: string,
  ) {
    super();
  }

  static from(id: string, raw: unknown): SendChatInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new SendChatInput(
          f.uuid('id'),
          f.text('requestId', 200),
          f.version(),
          f.text('message', Chat.MESSAGE_MAX),
        ),
    );
  }
}

/** GET /api/chats/:id */
export class ChatIdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): ChatIdInput {
    return BaseRequest.read({ id }, (f) => new ChatIdInput(f.uuid('id')));
  }
}

/**
 * MCP ask_agent { request_id, message, agent?, chat_id?, goal?, project? }: 기기가 서버 팀에 메시지를 보낸다.
 * chat_id가 없으면 새 대화(agent: 상대의 이름이나 id, 생략하면 기본 대표 · goal · project), 있으면 그 기기가 연 대화에 이어서
 */
export class AskAgentInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly message: string,
    readonly agent: string | null,
    readonly chatId: string | null,
    readonly goal: string | null,
    /** git 주소 그대로 (ChatProject가 맞춘다) */
    readonly project: string | null,
  ) {
    super();
  }

  static from(raw: unknown): AskAgentInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      raw,
      (f) =>
        new AskAgentInput(
          f.text('request_id', 200),
          f.text('message', Chat.MESSAGE_MAX),
          f.optionalText('agent', 100),
          body.chat_id === undefined || body.chat_id === null ? null : f.uuid('chat_id'),
          f.optionalText('goal', Chat.GOAL_MAX),
          f.optionalText('project', 400),
        ),
    );
  }
}
