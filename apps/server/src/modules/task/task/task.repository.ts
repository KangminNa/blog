import {
  and,
  asc,
  ChangeSignal,
  eq,
  inArray,
  like,
  lt,
  QueryTemplate,
  TableRepository,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { tasks } from '../task.schema';
import type { TaskRow } from '../task.tables';
import { Task } from './task';

// task.tasks + task_events ↔ Task. 불러오기·잠그기·저장(바뀐 칸만)은 기반이 하고, 여기에는 대기열 SQL과 실행 기록이 있다.
export class TaskRepository extends TableRepository<TaskRow, Task> {
  /** 실행 기록이 쌓였다는 신호 (콘솔의 실행 기록 화면이 다시 읽는다) */
  static readonly LOGGED = 'task.event.added';

  /** 공간을 모르고 id로 한 줄을 잠근다 */
  private static readonly LOCK_BY_ID = QueryTemplate.of<{ id: string }, TaskRow>((q) =>
    q
      .select()
      .from(tasks)
      .where(eq(tasks.id, QueryTemplate.value('id')))
      .for('update'),
  );
  /** 공간과 request_id로 한 줄 */
  private static readonly BY_REQUEST = QueryTemplate.of<
    { space: string; request: string },
    TaskRow
  >((q) =>
    q
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.space_id, QueryTemplate.value('space')),
          eq(tasks.request_id, QueryTemplate.value('request')),
        ),
      ),
  );
  /** 공간에서 이 request_id들 중 하나인 작업 */
  private static readonly BY_REQUESTS = QueryTemplate.of<
    { space: string; requests: readonly string[] },
    TaskRow
  >((q) =>
    q
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.space_id, QueryTemplate.value('space')),
          QueryTemplate.anyOf(tasks.request_id, 'requests'),
        ),
      ),
  );
  /** 에이전트의 끝나지 않은 작업 중 request_id가 패턴(LIKE)에 맞는 것 하나 */
  private static readonly OPEN_REQUEST = QueryTemplate.of<
    { agent: string; pattern: string },
    Pick<TaskRow, 'id'>
  >((q) =>
    q
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.agent_id, QueryTemplate.value('agent')),
          like(tasks.request_id, QueryTemplate.value('pattern')),
          inArray(tasks.status, [Task.QUEUED, Task.RUNNING, Task.WAITING]),
        ),
      )
      .limit(1),
  );
  /** 작업의 위 작업 id */
  private static readonly PARENT = QueryTemplate.of<{ id: string }, Pick<TaskRow, 'parent_id'>>(
    (q) =>
      q
        .select({ parent_id: tasks.parent_id })
        .from(tasks)
        .where(eq(tasks.id, QueryTemplate.value('id'))),
  );
  /** 위 작업이 맡긴 하위 작업, id 순서 */
  private static readonly CHILDREN = QueryTemplate.of<{ parent: string }, TaskRow>((q) =>
    q
      .select()
      .from(tasks)
      .where(eq(tasks.parent_id, QueryTemplate.value('parent')))
      .orderBy(asc(tasks.id)),
  );
  /** 임대가 끝난 진행 중 작업을 임대가 끝난 순서로 잠근다. 다른 쪽이 잡은 줄은 건너뛴다 */
  private static readonly LOCK_EXPIRED = QueryTemplate.of<{ now: Date; limit: number }, TaskRow>(
    (q) =>
      q
        .select()
        .from(tasks)
        .where(
          and(eq(tasks.status, Task.RUNNING), lt(tasks.lease_until, QueryTemplate.value('now'))),
        )
        .orderBy(asc(tasks.lease_until))
        .limit(QueryTemplate.value('limit'))
        .for('update', { skipLocked: true }),
  );

  protected readonly table = tasks;
  protected readonly noun = '작업';

  protected toEntity(row: TaskRow): Task {
    return Task.restore(row);
  }

  /** 공간을 모르고 잠근다 (일꾼이 이벤트로 받은 작업) */
  async lockById(id: string): Promise<Task | null> {
    return this.maybeOne(await TaskRepository.LOCK_BY_ID.rows(this.sql, { id }));
  }

  async findByRequest(spaceId: string, requestId: string): Promise<Task> {
    return this.one(
      await TaskRepository.BY_REQUEST.rows(this.sql, { space: spaceId, request: requestId }),
      this.noun,
    );
  }

  /**
   * 빌려 줄 작업을 잠근다. 다른 러너가 잡은 행은 건너뛰고, 담당이 없거나 일을 받을 수 있는 에이전트(ready)의 일만,
   * 우선순위 → 오래된 순. 멈췄거나 쉬는 에이전트의 일과 맡을 권한이 없는 일은 대기열에 남아 뒤의 일을 막지 않는다.
   * 연결 확인과 웹 로그인은 에이전트가 필요 없어 일을 받을 에이전트가 없어도 빌려 준다.
   * 그 둘은 도구로 거른다 (null이면 거르지 않는다): 연결 확인은 testTools, 웹 로그인은 signinTools의 도구만
   */
  async lockNext(
    spaceId: string,
    ready: readonly Agent[],
    limit: number,
    tools: { testTools: readonly string[] | null; signinTools: readonly string[] | null },
  ): Promise<readonly Task[]> {
    const agentIds = ready.map((a) => a.id);
    const rows = await this.sql<TaskRow[]>`
      SELECT * FROM task.tasks
      WHERE space_id = ${spaceId} AND status = ${Task.QUEUED}
        AND (kind = ANY(${Task.AGENTLESS as string[]}::text[])
          OR agent_id = ANY(${agentIds}::uuid[])
          OR (agent_id IS NULL AND ${agentIds.length > 0}))
        ${this.scoped(ready)}
        ${this.byTool(Task.AI_TEST, tools.testTools)}
        ${this.byTool(Task.AI_SIGNIN, tools.signinTools)}
      ORDER BY priority DESC, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 에이전트 없는 일의 종류 하나를 payload의 도구로 거른다 */
  private byTool(kind: string, tools: readonly string[] | null) {
    return tools === null
      ? this.sql``
      : this.sql`AND (kind <> ${kind} OR payload->>'tool' = ANY(${tools as string[]}::text[]))`;
  }

  /** 지금 도는 에이전트 일의 도구들 (갱신 토큰이 바뀌는 도구를 한 번에 하나만 돌리려고) */
  async runningAgentTools(spaceId: string): Promise<readonly string[]> {
    const rows = await this.sql<{ tool: string }[]>`
      SELECT DISTINCT a.tool FROM task.tasks t JOIN task.agents a ON a.id = t.agent_id
      WHERE t.space_id = ${spaceId} AND t.status = ${Task.RUNNING}`;
    return rows.map((r) => r.tool);
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

  /** 이 request_id들로 이미 만든 작업 (위임을 다시 보냈을 때) */
  async findByRequests(spaceId: string, requestIds: readonly string[]): Promise<readonly Task[]> {
    const rows = await TaskRepository.BY_REQUESTS.rows(this.sql, {
      space: spaceId,
      requests: requestIds,
    });
    return rows.map((r) => this.toEntity(r));
  }

  /** 이 에이전트에게 request_id가 prefix로 시작하는 끝나지 않은 작업이 있는가 (앞 하트비트 작업) */
  async hasOpenRequest(agentId: string, prefix: string): Promise<boolean> {
    const row = await TaskRepository.OPEN_REQUEST.one(this.sql, {
      agent: agentId,
      pattern: `${prefix}%`,
    });
    return row !== null;
  }

  /** 이 작업을 맡긴 위 작업의 id. 없으면 null */
  async parentOf(id: string): Promise<string | null> {
    const row = await TaskRepository.PARENT.one(this.sql, { id });
    return row?.parent_id ?? null;
  }

  /** 위 작업이 맡긴 하위 작업 전부 (id 순서. 한 번에 맡긴 것끼리는 순서가 정해지지 않는다). 잠그지 않는다 */
  async children(parentId: string): Promise<readonly Task[]> {
    const rows = await TaskRepository.CHILDREN.rows(this.sql, { parent: parentId });
    return rows.map((r) => this.toEntity(r));
  }

  /** 끝나지 않은 하위 작업의 수 */
  async openChildren(parentId: string): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      SELECT count(*) AS n FROM task.tasks
      WHERE parent_id = ${parentId} AND status IN (${Task.QUEUED}, ${Task.RUNNING}, ${Task.WAITING})`;
    return row?.n ?? 0;
  }

  /**
   * 끝나지 않은 아래 작업(하위의 하위까지)을 잠근다. 위 작업을 취소할 때 함께 취소한다.
   * 위 작업을 먼저 잠근 뒤에 부른다 (위 → 아래 순서. 하위 작업이 끝날 때 깨우는 쪽은 위 작업만 잠근다)
   */
  async lockOpenDescendants(parentId: string): Promise<readonly Task[]> {
    const rows = await this.sql<TaskRow[]>`
      WITH RECURSIVE below AS (
        SELECT id FROM task.tasks WHERE parent_id = ${parentId}
        UNION ALL
        SELECT t.id FROM task.tasks t JOIN below ON t.parent_id = below.id
      )
      SELECT * FROM task.tasks
      WHERE id IN (SELECT id FROM below)
        AND status IN (${Task.QUEUED}, ${Task.RUNNING}, ${Task.WAITING})
      ORDER BY id
      FOR UPDATE`;
    return rows.map((r) => this.toEntity(r));
  }

  /**
   * 공간과 도구의 웹 로그인 자리를 트랜잭션이 끝날 때까지 잠근다. 동시에 두 번 눌러도 로그인 작업은 하나다
   * (아직 로그인 줄이 없을 수 있어 행 대신 advisory 잠금)
   */
  async lockSigninSlot(spaceId: string, tool: string): Promise<void> {
    await this
      .sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ai_signin:${spaceId}:${tool}`}, 0))`;
  }

  /** 도구의 끝나지 않은 웹 로그인 (도구마다 하나) */
  async findPendingAiSignin(spaceId: string, tool: string): Promise<Task | null> {
    return this.maybeOne(
      await this.sql`
        SELECT * FROM task.tasks
        WHERE space_id = ${spaceId} AND kind = ${Task.AI_SIGNIN} AND payload->>'tool' = ${tool}
          AND status IN (${Task.QUEUED}, ${Task.RUNNING})
        ORDER BY id DESC LIMIT 1`,
    );
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
    const rows = await TaskRepository.LOCK_EXPIRED.rows(this.sql, { now, limit });
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

  /** 쌓인 실행 기록을 남긴다 (추가만) */
  protected override async saveParts(task: Task): Promise<void> {
    const entries = task.addedLog;
    if (entries.length === 0) return;
    await this.sql`INSERT INTO task.task_events ${this.sql(entries as never)}`;
    await ChangeSignal.send(this.sql, [
      new ChangeSignal(task.spaceId, TaskRepository.LOGGED, task.id),
    ]);
  }
}
