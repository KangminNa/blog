import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { ApprovalResultInput } from './approval.input';
import { ApprovalService } from './approval.service';

// 결재한 동작의 실행 결과를 받아 작업을 끝낸다. 모든 이벤트를 받고 결과를 담은 것만 처리한다
// (task는 어느 모듈이 실행하는지 모른다). 두 번 받아도 결과가 같다.
@Injectable()
export class ApprovalResultHandler extends BaseHandler {
  constructor(private readonly approvals: ApprovalService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!ApprovalResultInput.carriedBy(event.data)) return;
    await this.approvals.applyResult(
      new SystemActor(),
      event.spaceId,
      ApprovalResultInput.from(event.data),
    );
  }
}
