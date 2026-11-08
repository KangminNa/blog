import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import type { Row, Sql } from './database';

// 코어의 쿼리 도구 (객체설계 6장, 2026-11-08). 표 하나의 읽기와 쓰기를 조건 규칙으로 만든다.
// 기능 코드는 조건(칸 이름 → 값)과 방법만 적고 SQL은 여기서 만든다. 표를 잇거나 모으는 그 기능만의 쿼리는 각 패키지가 SQL로 쓴다.
// 같은 모양(표 · 조건의 종류 · 방법)은 처음 한 번만 SQL 글자로 만들어 기억하고, 실행은 부를 때의 연결(트랜잭션이든 아니든)에서 한다.
// 표 이름과 칸은 생성된 <모듈>.schema.ts의 표에서 받고, SQL은 Drizzle 쿼리 빌더가 아니라 여기서 만든다:
// 빌더는 jsonb 값을 미리 글자로 바꿔 우리 연결에서 두 번 인코딩되고, Drizzle 클라이언트는 우리 연결의 날짜 읽기를 바꾼다 (2026-11-08 시험).
// 값은 늘 $n 자리로 넘기고, 칸 이름은 표에 있는 것만 따옴표로 감싸 넣는다. 돌아오는 행은 지금 sql과 같다 (Date · bigint → number · jsonb).

/** 생성된 표의 행 모양 (칸 이름은 DB 그대로) */
export type RowOf<T extends PgTable> = T['$inferSelect'];

/** 조건 하나: 값(=), 목록(= ANY), null(IS NULL), 또는 Rule의 비교 */
type Condition<V> = V | readonly NonNullable<V>[] | Rule<NonNullable<V>>;

/** 조건 객체: 칸 이름 → 조건. 모두 AND로 잇는다 */
export type Where<R> = { readonly [K in keyof R]?: Condition<R[K]> };

/** 쓰는 값: 칸 이름 → 값, 또는 Rule.now(DB 시각) */
export type Changes<R> = { readonly [K in keyof R]?: R[K] | Rule<never> };

/** 정렬: 칸 이름, 내림차순이면 뒤에 ' desc' */
type Order<R> = (keyof R & string) | `${keyof R & string} desc`;

/** 고르는 방법 */
export interface How<R> {
  /** 고를 칸. 없으면 모두 (*) */
  readonly columns?: readonly (keyof R & string)[];
  readonly order?: readonly Order<R>[];
  readonly limit?: number;
  /** 고칠 행을 잠근다 (FOR UPDATE). 'skip'이면 다른 쪽이 잡은 행은 건너뛴다 (SKIP LOCKED) */
  readonly lock?: boolean | 'skip';
}

/** 비교 하나. 정적 메서드로만 만든다 */
export class Rule<V = unknown> {
  /** IS NOT NULL */
  static readonly set: Rule<never> = new Rule('set');
  /** 쓰는 값으로: DB의 지금 시각 (now()) */
  static readonly now: Rule<never> = new Rule('now');
  /** 조건 없음 (Rule.maybe가 돌려준다) */
  private static readonly none: Rule<never> = new Rule('none');

  private constructor(
    private readonly op: string,
    readonly value?: V,
  ) {}

  static before<V>(value: V): Rule<V> {
    return new Rule('<', value);
  }

  static atMost<V>(value: V): Rule<V> {
    return new Rule('<=', value);
  }

  static after<V>(value: V): Rule<V> {
    return new Rule('>', value);
  }

  static atLeast<V>(value: V): Rule<V> {
    return new Rule('>=', value);
  }

  static not<V>(value: V): Rule<V> {
    return new Rule('<>', value);
  }

  static like(pattern: string): Rule<string> {
    return new Rule('LIKE', pattern);
  }

  /**
   * 값이 없으면(null · undefined) 조건을 뺀다. compare를 주면 그 비교로 (예: Rule.maybe(cursor, Rule.before)).
   * 조건을 빼는 길은 이것 하나다: 그냥 undefined면 오류 (공간 조건이 실수로 빠지지 않게)
   */
  static maybe<V>(value: V | null | undefined, compare?: (value: V) => Rule<V>): V | Rule<V> {
    if (value === null || value === undefined) return Rule.none;
    return compare ? compare(value) : value;
  }

  /** 조건 하나를 모양(열쇠)과 넣을 값으로. 조건이 없으면 null */
  static read(value: unknown): { kind: string; value?: unknown } | null {
    if (value instanceof Rule) {
      if (value.op === 'none') return null;
      if (value.op === 'set' || value.op === 'now') return { kind: value.op };
      return { kind: value.op, value: value.value };
    }
    if (value === null) return { kind: 'null' };
    if (Array.isArray(value)) return { kind: 'any', value };
    return { kind: '=', value };
  }

  /** 모양 하나를 SQL 조각으로. param은 다음 값 자리($n) */
  static sql(column: string, kind: string, param: () => string): string {
    if (kind === 'null') return `${column} IS NULL`;
    if (kind === 'set') return `${column} IS NOT NULL`;
    if (kind === 'any') return `${column} = ANY(${param()})`;
    return `${column} ${kind} ${param()}`;
  }
}

/** 표 하나의 쿼리 도구. 표마다 하나를 만들어 모양별 SQL을 기억한다 */
export class TableQuery {
  private static readonly tables = new WeakMap<PgTable, TableQuery>();
  /** 모양 열쇠 → SQL 글자 */
  private readonly shapes = new Map<string, string>();

  private constructor(
    /** 스키마까지 적은 표 이름 (예: task.goals) */
    readonly name: string,
    private readonly columns: ReadonlySet<string>,
  ) {}

  static of(table: PgTable): TableQuery {
    let made = TableQuery.tables.get(table);
    if (!made) {
      const config = getTableConfig(table);
      const name = config.schema ? `${config.schema}.${config.name}` : config.name;
      made = new TableQuery(name, new Set(config.columns.map((c) => c.name)));
      TableQuery.tables.set(table, made);
    }
    return made;
  }

  /** 조건에 맞는 행들 */
  async rows(sql: Sql, where: object, how: How<Record<string, unknown>> = {}): Promise<Row[]> {
    const conditions = this.conditions(where);
    const values = conditions.flatMap((c) => ('value' in c ? [c.value] : []));
    if (how.limit !== undefined) values.push(how.limit);
    const key = `r|${TableQuery.keyOf(conditions)}|${how.columns ?? '*'}|${how.order ?? ''}|${how.limit !== undefined}|${how.lock ?? false}`;
    return this.run(sql, key, values, () => {
      const at = TableQuery.counter();
      const columns = how.columns ? how.columns.map((c) => this.column(c)).join(', ') : '*';
      const order = (how.order ?? []).map((o) => {
        const [column, way] = o.split(' ');
        return `${this.column(column ?? '')}${way === 'desc' ? ' DESC' : ''}`;
      });
      return [
        `SELECT ${columns} FROM ${this.quoted}`,
        this.whereSql(conditions, at),
        order.length > 0 ? `ORDER BY ${order.join(', ')}` : '',
        how.limit !== undefined ? `LIMIT ${at()}` : '',
        how.lock ? `FOR UPDATE${how.lock === 'skip' ? ' SKIP LOCKED' : ''}` : '',
      ]
        .filter(Boolean)
        .join(' ');
    });
  }

  /** 조건에 맞는 행이 있는가 */
  async exists(sql: Sql, where: object): Promise<boolean> {
    const conditions = this.conditions(where);
    const values = conditions.flatMap((c) => ('value' in c ? [c.value] : []));
    const rows = await this.run(sql, `e|${TableQuery.keyOf(conditions)}`, values, () => {
      const at = TableQuery.counter();
      return `SELECT 1 FROM ${this.quoted} ${this.whereSql(conditions, at)} LIMIT 1`;
    });
    return rows.length > 0;
  }

  /** 새 행들을 넣는다 (넣을 칸은 행마다 같아야 한다) */
  async insert(sql: Sql, rows: object | readonly object[]): Promise<void> {
    if (Array.isArray(rows) && rows.length === 0) return;
    for (const column of Object.keys(Array.isArray(rows) ? rows[0] : rows)) this.column(column);
    await sql`INSERT INTO ${sql(this.name)} ${sql(rows as never)}`;
  }

  /** 조건에 맞는 행들을 고친다. 고친 수를 돌려준다. 조건 없이 고치지 않는다 */
  async update(sql: Sql, changes: object, where: object): Promise<number> {
    const sets = Object.entries(changes)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [column, value] of sets)
      if (value instanceof Rule && value !== Rule.now)
        throw new Error(`쓰는 값에는 Rule.now만 쓸 수 있어요: ${this.name}.${column}`);
    const conditions = this.conditions(where, true);
    const values = [
      ...sets.flatMap(([, value]) => (value === Rule.now ? [] : [value])),
      ...conditions.flatMap((c) => ('value' in c ? [c.value] : [])),
    ];
    const setKey = sets.map(([c, v]) => `${c}${v === Rule.now ? '@now' : ''}`).join(',');
    const rows = await this.run(sql, `u|${setKey}|${TableQuery.keyOf(conditions)}`, values, () => {
      const at = TableQuery.counter();
      const assigned = sets.map(
        ([column, value]) => `${this.column(column)} = ${value === Rule.now ? 'now()' : at()}`,
      );
      return `UPDATE ${this.quoted} SET ${assigned.join(', ')} ${this.whereSql(conditions, at)}`;
    });
    return rows.count;
  }

  /** 조건에 맞는 행들을 지운다. 지운 수를 돌려준다. 조건 없이 지우지 않는다 */
  async delete(sql: Sql, where: object): Promise<number> {
    const conditions = this.conditions(where, true);
    const values = conditions.flatMap((c) => ('value' in c ? [c.value] : []));
    const rows = await this.run(sql, `d|${TableQuery.keyOf(conditions)}`, values, () => {
      const at = TableQuery.counter();
      return `DELETE FROM ${this.quoted} ${this.whereSql(conditions, at)}`;
    });
    return rows.count;
  }

  /** 모양별 SQL을 처음 한 번만 만들어 기억하고, 이번 연결에서 돌린다 */
  private async run(
    sql: Sql,
    key: string,
    values: unknown[],
    build: () => string,
  ): Promise<Row[] & { count: number }> {
    let text = this.shapes.get(key);
    if (!text) {
      text = build();
      this.shapes.set(key, text);
    }
    return (await sql.unsafe(text, values as never[], { prepare: true })) as unknown as Row[] & {
      count: number;
    };
  }

  /** 조건 객체를 칸 이름 순서의 조건들로. 빠진 값(undefined)은 오류 */
  private conditions(
    where: object,
    required = false,
  ): { column: string; kind: string; value?: unknown }[] {
    const found = Object.entries(where)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([column, value]) => {
        this.column(column);
        if (value === undefined)
          throw new Error(`조건 값이 없어요: ${this.name}.${column} (조건을 빼려면 Rule.maybe)`);
        const read = Rule.read(value);
        return read ? [{ column, ...read }] : [];
      });
    if (required && found.length === 0)
      throw new Error(`조건 없이 ${this.name}의 모든 행을 고치거나 지우지 않는다`);
    return found;
  }

  private whereSql(conditions: readonly { column: string; kind: string }[], at: () => string) {
    if (conditions.length === 0) return '';
    return `WHERE ${conditions.map((c) => Rule.sql(this.column(c.column), c.kind, at)).join(' AND ')}`;
  }

  /** 표에 있는 칸만 따옴표로 감싼다 */
  private column(name: string): string {
    if (!this.columns.has(name)) throw new Error(`${this.name}에 없는 칸이에요: ${name}`);
    return `"${name}"`;
  }

  private get quoted(): string {
    return this.name
      .split('.')
      .map((part) => `"${part}"`)
      .join('.');
  }

  private static keyOf(conditions: readonly { column: string; kind: string }[]): string {
    return conditions.map((c) => `${c.column}${c.kind}`).join(',');
  }

  /** 값 자리 번호 ($1, $2, …) */
  private static counter(): () => string {
    let n = 0;
    return () => `$${++n}`;
  }
}

/** 표 하나를 조건 규칙으로 읽는 기반: BaseQuery와 BaseRepository가 함께 쓴다 */
export abstract class TableReader {
  protected abstract readonly sql: Sql;

  /** 조건에 맞는 행들 (예: this.rows(tasks, { space_id: s }, { order: ['id desc'], limit: 20 })) */
  protected rows<T extends PgTable>(
    table: T,
    where: Where<RowOf<T>>,
    how?: How<RowOf<T>>,
  ): Promise<RowOf<T>[]> {
    return TableQuery.of(table).rows(
      this.sql,
      where,
      how as How<Record<string, unknown>>,
    ) as Promise<RowOf<T>[]>;
  }

  /** 조건에 맞는 첫 행. 없으면 null */
  protected async row<T extends PgTable>(
    table: T,
    where: Where<RowOf<T>>,
    how?: How<RowOf<T>>,
  ): Promise<RowOf<T> | null> {
    const [found] = await this.rows(table, where, how);
    return found ?? null;
  }

  /** 조건에 맞는 행이 있는가 */
  protected exists<T extends PgTable>(table: T, where: Where<RowOf<T>>): Promise<boolean> {
    return TableQuery.of(table).exists(this.sql, where);
  }

  /**
   * 한 쪽보다 하나 더 읽은 행들을 한 쪽으로 자른다. 넘치면 마지막 행으로 다음 커서를 만든다
   * (커서의 모양은 목록마다 달라 부르는 쪽이 정한다)
   */
  protected pageOf<R>(
    rows: readonly R[],
    size: number,
    cursorOf: (last: R) => string | null,
  ): { items: R[]; next: string | null } {
    const items = rows.slice(0, size);
    const last = items.at(-1);
    return { items, next: rows.length > size && last !== undefined ? cursorOf(last) : null };
  }
}
