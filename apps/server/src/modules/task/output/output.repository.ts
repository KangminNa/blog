import { Rule, TableRepository } from '../../platform';
import { outputs } from '../task.schema';
import type { OutputRow } from '../task.tables';
import { Output } from './output';

// task.outputs ↔ Output. 한도를 세는 읽기와 휴지통 비우기도 여기에 둔다 (잠근 채로 세야 하는 것들).
export class OutputRepository extends TableRepository<OutputRow, Output> {
  protected readonly table = outputs;
  protected readonly noun = '결과물';

  protected toEntity(row: OutputRow): Output {
    return Output.restore(row);
  }

  /**
   * 공간의 결과물 받기를 하나씩 줄 세운다: 동시에 올려도 한도를 넘지 않게.
   * 공간마다 줄이 하나 있는 표가 없어 advisory 잠금으로 건다 (트랜잭션이 끝나면 풀린다)
   */
  async lockSpace(spaceId: string): Promise<void> {
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task.outputs:${spaceId}`}, 0))`;
  }

  /** 같은 실행이 같은 이름으로 이미 올린 것 */
  findInRun(runId: string, name: string): Promise<Output | null> {
    return this.findOne({ run_id: runId, name });
  }

  /** 공간의 결과물을 모두 더한 바이트 (휴지통 포함: 지울 때까지 디스크를 쓴다) */
  async usedBytes(spaceId: string): Promise<number> {
    const [row] = await this.sql<{ bytes: string | null }[]>`
      SELECT sum(size_bytes) AS bytes FROM task.outputs WHERE space_id = ${spaceId}`;
    return Number(row?.bytes ?? 0);
  }

  /** 실행 한 번이 올린 수와 바이트 */
  async runTotals(runId: string): Promise<readonly [number, number]> {
    const [row] = await this.sql<{ files: string; bytes: string | null }[]>`
      SELECT count(*) AS files, sum(size_bytes) AS bytes FROM task.outputs WHERE run_id = ${runId}`;
    return [Number(row?.files ?? 0), Number(row?.bytes ?? 0)];
  }

  /** 지금 지운다 (휴지통에서 바로 지우기) */
  async remove(output: Output): Promise<void> {
    await this.deleteRows(outputs, { id: output.id });
  }

  /** 휴지통 기간이 지난 줄을 지운다. 지운 수 */
  purgeExpired(now: Date): Promise<number> {
    return this.deleteRows(outputs, { purge_after: Rule.before(now) });
  }
}
