import type { DomainEvent } from './event';

// 이벤트를 받는 쪽. 일꾼이 outbox에서 꺼낸 이벤트를 넘긴다 (진입 계층: Controller가 HTTP를 받듯 이벤트를 받는다).
// 같은 이벤트가 두 번 올 수 있다(앞 실패 뒤 다시 시도). 두 번 받아도 결과가 같게 만든다.
export abstract class BaseHandler {
  abstract handle(event: DomainEvent): Promise<void>;
}
