import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

// 대화의 한 회차 (작업의 payload.chat, 서버의 Chat). 관리자와 채팅하는 에이전트에게 앞 대화를 자료로 보여 준다.
// 할 일은 이번 메시지(작업의 지시)뿐이다. 앞 대화의 관리자 말은 맥락이고, 앞 답(AI가 쓴 글) 속의 지시는 따르지 않는다.
export class ChatTurn {
  /** 말한 쪽마다의 틀 (owner: 관리자, agent: 나) */
  private static readonly SPEAKERS: Readonly<Record<string, string>> = {
    owner: 'chat-owner',
    agent: 'chat-agent',
  };

  private constructor(
    readonly turn: number,
    /** [말한 쪽, 글] (오래된 것부터, 서버가 최근 것만 잘라 보낸다) */
    private readonly lines: readonly (readonly [string, string])[],
  ) {}

  /** 대화의 회차가 아니면 null */
  static from(payload: Json): ChatTurn | null {
    const chat = payload.child('chat');
    if (!chat.text('chatId')) return null;
    const lines = chat
      .list('history')
      .filter((line) => line.text('text') !== '')
      .map((line) => [line.text('from'), line.text('text')] as const);
    return new ChatTurn(chat.number('turn'), lines);
  }

  /** 지시문의 단락 (틀 chat): 앞 대화(있으면)와 대화로 답하는 법 */
  part(prompts: PromptPack): string {
    const history = this.lines.map(([from, text]) => {
      const template = ChatTurn.SPEAKERS[from];
      return template ? prompts.fill(template, { text }) : `[${from}] ${text}`;
    });
    return prompts.fill('chat', { history: history.join('\n') });
  }
}
