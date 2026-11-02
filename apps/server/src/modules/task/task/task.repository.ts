import { ChangeSignal, TableRepository } from '../../platform';
import type { Agent } from '../agent/agent';
import type { TaskRow } from '../task.tables';
import { Task } from './task';

// task.tasks + task_events ↔ Task. 불러오기와 저장은 기반이 하고, 여기에는 대기열 SQL과 실행 기록이 있다.
export class TaskRepository extends TableRepository<TaskRow, Task> {
  /** 실행 기록이 쌓였다는 신호 (콘솔의 실행 기록 화면이 다시 읽는다) */
  static readonly LOGGED = 'task.event.added';

  protected readonly table = 'task.tasks';
  protected readonly noun = '작업';

  protected toEntity(row: TaskRow): Task {
    return Task.restore(row);
  }

  async findByRequest(spaceId: string, requestId: string): Promise<Task> {
    return this.one(
      await this.sql`
        SELECT * FROM task.tasks WHERE space_id = ${spaceId} AND request_id = ${requestId}`,
      this.noun,
    );
  }

  /**
   * 빌려 줄 작업을 잠근다. 다른 러너가 잡은 행은 건너뛰고, 담당이 없거나 일을 받을 수 있는 에이전트(ready)의 일만,
   * 우선순위 → 오래된 순. 멈췄거나 쉬는 에이전트의 일과 맡을 권한이 없는 일은 대기열에 남아 뒤의 일을 막지 않는다.
   * 연결 확인은 에이전트가 필요 없어 일을 받을 에이전트가 없어도 빌려 준다.
   */
  async lockNext(
    spaceId: string,
    ready: readonly Agent[],
    limit: number,
  ): Promise<readonly Task[]> {
    const agentIds = ready.map((a) => a.id);
    const rows = await this.sql<TaskRow[]>`
      SELECT * FROM task.tasks
      WHERE space_id = ${spaceId} AND status = ${Task.QUEUED}
        AND (kind = ${Task.AI_TEST}
          OR agent_id = ANY(${agentIds}::uuid[])
          OR (agent_id IS NULL AND ${agentIds.length > 0}))
        ${this.scoped(ready)}
      ORDER BY priority DESC, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 권한이 필요한 종류는 그 권한을 가진 에이전트의 일이거나, 담당이 없어도 맡을 에이전트가 있을 때만 */
  private scoped(ready: readonly Agent[]) {
    return Object.entries(Task.SCOPES).reduce((found, [kind, needed]) => {
      const able = ready
        .filter((a) => needed.every((scope) => a.scopes.includes(scope)))
        .map((a) => a.id);
      return this.sql`${found} AND (kind <> ${kind} OR agent_id = ANY(${able}::uuid[])
        OR (agent_id IS NULL AND ${able.length > 0}::boolean))`;
    }, this.sql``);
  }

  /** 도구의 끝나지 않은 연결 확인 */
  async findPendingAiTest(spaceId: string, tool: string): Promise<Task | null> {
    return this.maybeOne(
      await this.sql`
        SELECT * FROM task.tasks
        WHERE space_id = ${spaceId} AND kind = ${Task.AI_TEST} AND payload->>'tool' = ${tool}
          AND status IN (${Task.QUEUED}, ${Task.RUNNING})
        LIMIT 1`,
    );
  }

  /** 임대가 끝난 작업을 잠근다 */
  async lockExpired(now: Date, limit: number): Promise<readonly Task[]> {
    const rows = await this.sql<TaskRow[]>`
      SELECT * FROM task.tasks
      WHERE status = ${Task.RUNNING} AND lease_until < ${now}
      ORDER BY lease_until LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => this.toEntity(r));
  }

  /**
   * 새 작업을 넣는다. 같은 requestId가 이미 있으면 넣지 않고 false (동시에 와도 하나만).
   * 앞의 요청이 아직 커밋 전이면 끝날 때까지 기다렸다가 판단한다.
   */
  async insertOnce(task: Task): Promise<boolean> {
    const [row] = await this.sql<TaskRow[]>`
      INSERT INTO task.tasks ${this.sql(task.unsaved as never)}
      ON CONFLICT (space_id, request_id) DO NOTHING
      RETURNING *`;
    if (!row) return false;
    task.saved(row);
    await this.publishEvents(task);
    return true;
  }

  /** 임대만 늘린다. version은 사람이 본 내용을 지키는 값이라 올리지 않는다 (진행 보고가 주인의 취소를 막지 않게) */
  async saveLease(task: Task): Promise<void> {
    const until = task.unsaved.lease_until;
    if (until !== undefined)
      await this.sql`UPDATE task.tasks SET lease_until = ${until} WHERE id = ${task.id}`;
    await this.saveParts(task);
  }

  /** 쌓인 실행 기록을 남긴다 */
  protected override async saveParts(task: Task): Promise<void> {
    const entries = task.addedLog;
    if (entries.length === 0) return;
    await this.sql`INSERT INTO task.task_events ${this.sql(entries as never)}`;
    await ChangeSignal.send(this.sql, [
      new ChangeSignal(task.spaceId, TaskRepository.LOGGED, task.id),
    ]);
  }
}
