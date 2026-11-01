import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { SessionSavedInput } from './tidy.input';
import { TidyService } from './tidy.service';

// 세션의 새 판이 저장되면 자동 정리를 요청한다 (vault.session.saved). 꺼져 있으면 아무 일 없이 처리됨으로 넘어간다.
// 같은 이벤트가 두 번 와도 requestId가 같아 작업은 하나다.
@Injectable()
export class TidyRequestHandler extends BaseHandler {
  constructor(private readonly tidy: TidyService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    await this.tidy.saved(new SystemActor(), event.spaceId, SessionSavedInput.from(event.data));
  }
}
