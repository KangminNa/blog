import type { Sql } from './database';
import { Conflict } from './errors';

// 같은 요청은 한 번만 반영한다 (platform.idempotency). AI 도구가 응답을 못 받아 같은 request_id로 다시 보내도
// 처음 결과를 그대로 돌려준다. Outbox처럼 호출한 쪽의 트랜잭션 안에서 쓴다: 결과 기록과 데이터 변경이 함께 커밋된다.
//
//   const once = new Idempotency(tx, deviceId, requestId, 'save_session');
//   const before = await once.previous();   // 이미 처리한 요청이면 그때의 결과
//   …저장…
//   await once.remember(result);
export class Idempotency {
  constructor(
    private readonly tx: Sql,
    private readonly deviceId: string,
    private readonly requestId: string,
    private readonly action: string,
  ) {}

  /**
   * 처음 온 요청이면 null(이 요청의 자리를 잡는다), 이미 처리한 요청이면 그때 남긴 결과.
   * 같은 요청이 동시에 오면 뒤에 온 쪽은 앞의 트랜잭션이 끝날 때까지 기다렸다가 그 결과를 받는다.
   */
  async previous(): Promise<Readonly<Record<string, unknown>> | null> {
    const claimed = await this.tx`
      INSERT INTO platform.idempotency (device_id, request_id, tool, response)
      VALUES (${this.deviceId}, ${this.requestId}, ${this.action}, '{}')
      ON CONFLICT (device_id, request_id) DO NOTHING
      RETURNING request_id`;
    if (claimed.length > 0) return null;
    const [row] = await this.tx`
      SELECT tool, response FROM platform.idempotency
      WHERE device_id = ${this.deviceId} AND request_id = ${this.requestId}`;
    if (row && row.tool !== this.action)
      throw new Conflict(
        `다른 도구(${row.tool})에 이미 쓴 request_id예요. 요청마다 새 request_id를 만들어 주세요`,
      );
    return (row?.response as Record<string, unknown> | undefined) ?? null;
  }

  /** 처리 결과를 남긴다. previous()가 null이었을 때, 같은 트랜잭션의 마지막에 부른다 */
  async remember(result: object): Promise<void> {
    await this.tx`
      UPDATE platform.idempotency SET response = ${this.tx.json(result as never)}
      WHERE device_id = ${this.deviceId} AND request_id = ${this.requestId}`;
  }
}
