import { TableRepository } from '../../platform';
import { approvals } from '../task.schema';
import type { ApprovalRow } from '../task.tables';
import { Approval } from './approval';

// task.approvals ↔ Approval. 불러오기와 저장은 기반이 하고, 여기에는 찾는 SQL만 있다.
export class ApprovalRepository extends TableRepository<ApprovalRow, Approval> {
  protected readonly table = approvals;
  protected readonly noun = '결재';

  protected toEntity(row: ApprovalRow): Approval {
    return Approval.restore(row);
  }

  /** 있을 수도 없을 수도 있을 때 (다른 모듈의 이벤트가 가리킨 결재) */
  async findIn(spaceId: string, id: string): Promise<Approval | null> {
    return this.maybeOne(await this.select(spaceId, id, false));
  }

  /** 대상이 기다리는 결재를 잠근다 (작업에 묶이지 않는 결재: 목표 실행) */
  async lockPendingFor(targetKind: string, targetId: string): Promise<Approval | null> {
    return this.findOne(
      { target_kind: targetKind, target_id: targetId, status: Approval.PENDING },
      { lock: true },
    );
  }

  /** 작업이 기다리는 결재를 잠근다 (작업 하나에 하나뿐이다) */
  async lockPending(taskId: string): Promise<Approval | null> {
    return this.findOne({ task_id: taskId, status: Approval.PENDING }, { lock: true });
  }

  /** 대화의 기다리는 결과 카드 (대화마다 하나) */
  lockOpenCard(chatId: string): Promise<Approval | null> {
    return this.findOne(
      { action: Approval.CARD, target_id: chatId, status: Approval.PENDING },
      { lock: true },
    );
  }

  /** 대화의 일에서 올라와 아직 카드에 실리지 않은 결재 (기다리는 것만, id 순서로 잠근다) */
  lockUncarded(chatId: string): Promise<readonly Approval[]> {
    return this.find(
      { chat_id: chatId, status: Approval.PENDING, card_id: null },
      { order: ['id'], lock: true },
    );
  }

  /** 카드에 실린 기다리는 결재 (읽기만: 작업을 먼저 잠근 뒤 lock으로 다시 잠근다) */
  inCard(cardId: string): Promise<readonly Approval[]> {
    return this.find({ card_id: cardId, status: Approval.PENDING }, { order: ['id'] });
  }
}
