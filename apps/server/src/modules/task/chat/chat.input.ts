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
