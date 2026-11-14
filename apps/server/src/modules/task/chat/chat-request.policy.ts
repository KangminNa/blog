// 대화의 일을 찾는 request_id (작업 쪽에 대화를 가리키는 칸을 두지 않아서 이름으로 찾는다. 목표 실행과 같다):
//   회차 chat:<대화>:<회차>, 그 덧붙인 말의 답 …:reply:<n>, 검토 …:review, 배정 chat-route:<대화>:<id> (2차 1-5).
// 배정 일은 chat: 로 시작하지 않는다: 대화의 일 · 결과 카드 · 소식 규칙(chat:<대화>:%)에 섞이지 않게
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 이름 규칙 한 곳. Chat · Repository · Query가 함께 쓴다
export class ChatRequest {
  /** 회차 작업의 맨 앞 (SQL이 대화 id · 회차를 이어 붙인다) */
  static readonly TURN_PREFIX = 'chat:';
  /** 배정 일의 맨 앞 (SQL이 대화 id를 이어 붙인다) */
  static readonly ROUTE_PREFIX = 'chat-route:';

  /** 회차 작업 */
  static turn(chatId: string, turn: number): string {
    return `${ChatRequest.TURN_PREFIX}${chatId}:${turn}`;
  }

  /** 회차의 결과를 결재 전에 검토하는 작업 (검토자 짝, 2차 2단계) */
  static review(chatId: string, turn: number): string {
    return `${ChatRequest.turn(chatId, turn)}:review`;
  }

  /** from회차부터 to회차까지 (작업을 찾는 데 쓴다) */
  static turns(chatId: string, from: number, to: number): string[] {
    const ids: string[] = [];
    for (let turn = Math.max(1, from); turn <= to; turn++) ids.push(ChatRequest.turn(chatId, turn));
    return ids;
  }

  /** 이 대화의 배정 일들의 앞부분 */
  static route(chatId: string): string {
    return `${ChatRequest.ROUTE_PREFIX}${chatId}:`;
  }

  /** 배정 일이 고르는 대화 (request_id chat-route:<대화>:<id>). 배정 일이 아니면 null */
  static routedChat(requestId: string | null): string | null {
    if (!requestId?.startsWith(ChatRequest.ROUTE_PREFIX)) return null;
    return requestId.slice(ChatRequest.ROUTE_PREFIX.length).split(':')[0] || null;
  }
}
