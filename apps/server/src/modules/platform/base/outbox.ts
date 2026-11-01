import type { Sql } from './database';
import type { DomainEvent } from './event';

/**
 * 무언가 바뀌었다는 신호 (Postgres NOTIFY). 트랜잭션 안에서 보내면 커밋할 때 전달되고, 취소되면 사라진다.
 * 내용은 담지 않는다: 화면은 신호를 받고 REST로 다시 읽고, 러너는 다음 조회에서 찾는다.
 */
export class ChangeSignal {
  static readonly CHANNEL = 'cairn_changes';

  constructor(
    readonly spaceId: string,
    readonly topic: string,
    readonly id: string,
  ) {}

  static async send(tx: Sql, signals: readonly ChangeSignal[]): Promise<void> {
    if (signals.length === 0) return;
    const payloads = signals.map((s) => JSON.stringify(s));
    await tx`SELECT pg_notify(${ChangeSignal.CHANNEL}, p) FROM unnest(${payloads}::text[]) AS p`;
  }

  static parse(payload: string): ChangeSignal {
    const v = JSON.parse(payload) as { spaceId: string; topic: string; id: string };
    return new ChangeSignal(v.spaceId, v.topic, v.id);
  }
}

// 이벤트를 호출한 쪽의 트랜잭션 안에서 platform.outbox에 남기고 변경 신호를 보낸다.
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
    const saved = await this.tx`
      INSERT INTO platform.outbox ${this.tx(rows, 'space_id', 'topic', 'payload')}
      RETURNING id`;
    await ChangeSignal.send(
      this.tx,
      events.map(
        (e, i) => new ChangeSignal(e.spaceId, e.name, Outbox.subjectOf(e, String(saved[i]?.id))),
      ),
    );
  }

  /** 화면이 알아볼 id: 이벤트의 주인공(내용에서 처음 나오는 `…Id` 값), 없으면 outbox 행 번호 */
  private static subjectOf(event: DomainEvent, rowId: string): string {
    const found = Object.entries(event.data).find(
      ([key, value]) => key.endsWith('Id') && typeof value === 'string',
    );
    return found ? String(found[1]) : rowId;
  }
}
