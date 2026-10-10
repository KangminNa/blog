import type { Sql } from './database';
import type { DomainEvent } from './event';

// 이벤트를 호출한 쪽의 트랜잭션 안에서 platform.outbox에 남긴다.
// 데이터 변경과 이벤트 기록이 함께 커밋되거나 함께 취소된다.
export class Outbox {
  constructor(private readonly tx: Sql) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    const rows = events.map((e) => ({
      space_id: e.spaceId,
      topic: e.name,
      payload: { v: e.version, ...e.data },
    }));
    await this.tx`INSERT INTO platform.outbox ${this.tx(rows, 'space_id', 'topic', 'payload')}`;
  }
}
