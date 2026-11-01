import { BaseRepository, ChangeSignal, type Row } from '../../platform';
import type { Agent } from '../agent/agent';
import { Task } from './task';

// task.tasks + task_events ↔ Task. 고칠 때는 엔티티가 기억한 바뀐 열만 저장한다.
export class TaskRepository extends BaseRepository<Task> {
  /** 실행 기록이 쌓였다는 신호 (콘솔의 실행 기록 화면이 다시 읽는다) */
  static readonly LOGGED = 'task.event.added';

  protected toEntity(row: Row): Task {
    return Task.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      row.agent_id === null ? null : String(row.agent_id),
      String(row.kind),
      String(row.title),
      String(row.instruction),
      (row.payload as Record<string, unknown> | null) ?? {},
      (row.result as Record<string, unknown> | null) ?? null,
      row.target_kind === null ? null : String(row.target_kind),
      row.target_id === null ? null : String(row.target_id),
      row.base_version === null ? null : Number(row.base_version),
      String(row.status),
      Number(row.priority),
      row.lease_until === null ? null : new Date(row.lease_until),
      row.leased_by === null ? null : String(row.leased_by),
      Number(row.attempts),
      row.request_id === null ? null : String(row.request_id),
      new Date(row.created_at),
      row.finished_at === null ? null : new Date(row.finished_at),
    );
  }

  async load(spaceId: string, id: string): Promise<Task> {
    return this.one(
      await this.sql`SELECT * FROM task.tasks WHERE id = ${id} AND space_id = ${spaceId}`,
      '작업',
    );
  }

  /** 고칠 작업을 잠근다. 없으면 NotFound */
  async lock(spaceId: string, id: string): Promise<Task> {
    return this.one(
      await this
        .sql`SELECT * FROM task.tasks WHERE id = ${id} AND space_id = ${spaceId} FOR UPDATE`,
      '작업',
    );
  }

  /** 공간을 모르고 잠근다 (일꾼이 이벤트로 받은 작업) */
  async lockById(id: string): Promise<Task | null> {
    return this.maybeOne(await this.sql`SELECT * FROM task.tasks WHERE id = ${id} FOR UPDATE`);
  }

  async findByRequest(spaceId: string, requestId: string): Promise<Task> {
    return this.one(
      await this.sql`
        SELECT * FROM task.tasks WHERE space_id = ${spaceId} AND request_id = ${requestId}`,
      '작업',
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
    const rows = await this.sql`
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
    const rows = await this.sql`
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
    const inserted = await this.sql`
      INSERT INTO task.tasks (id, space_id, agent_id, kind, title, instruction, payload, target_kind,
        target_id, base_version, status, priority, request_id, created_at)
      VALUES (${task.id}, ${task.spaceId}, ${task.agentId}, ${task.kind}, ${task.title}, ${task.instruction},
        ${this.sql.json(task.payload as never)}, ${task.targetKind}, ${task.targetId}, ${task.baseVersion},
        ${task.status}, ${task.priority}, ${task.requestId}, ${task.createdAt})
      ON CONFLICT (space_id, request_id) DO NOTHING
      RETURNING id`;
    if (inserted.length === 0) return false;
    task.clearChanges();
    await this.publishEvents(task);
    return true;
  }

  async save(task: Task): Promise<void> {
    if (task.changed) {
      const { payload, result, ...columns } = task.changes;
      const json = {
        ...(payload === undefined ? {} : { payload: this.sql.json(payload as never) }),
        ...(result === undefined ? {} : { result: this.sql.json(result as never) }),
      };
      const update = await this.sql`
        UPDATE task.tasks SET ${this.sql({ ...columns, ...json })}, version = version + 1
        WHERE id = ${task.id} AND version = ${task.version}`;
      this.expectUpdated(update.count, task);
      task.clearChanges();
    }
    await this.addLog(task);
    await this.publishEvents(task);
  }

  /** 임대만 늘린다. version은 사람이 본 내용을 지키는 값이라 올리지 않는다 (진행 보고가 주인의 취소를 막지 않게) */
  async saveLease(task: Task): Promise<void> {
    await this.sql`UPDATE task.tasks SET lease_until = ${task.leaseUntil} WHERE id = ${task.id}`;
    await this.addLog(task);
  }

  private async addLog(task: Task): Promise<void> {
    const entries = task.addedLog;
    if (entries.length === 0) return;
    const rows = entries.map((e) => ({
      task_id: task.id,
      at: e.at,
      kind: e.kind,
      body: e.body,
      tokens: e.tokens,
    }));
    await this.sql`
      INSERT INTO task.task_events ${this.sql(rows, 'task_id', 'at', 'kind', 'body', 'tokens')}`;
    await ChangeSignal.send(this.sql, [
      new ChangeSignal(task.spaceId, TaskRepository.LOGGED, task.id),
    ]);
  }
}
