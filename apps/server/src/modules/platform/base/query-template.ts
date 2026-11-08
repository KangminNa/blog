import { Column, sql as drizzleSql, fillPlaceholders, is, type SQL } from 'drizzle-orm';
import {
  getTableConfig,
  type PgColumn,
  type PgSelectConfig,
  type PgTable,
  QueryBuilder,
} from 'drizzle-orm/pg-core';
import type { Row, Sql } from './database';

// 미리 만든 읽기 (객체설계 6장, 2026-11-08). 클래스의 static으로 한 번 만들어 두고 부를 때마다 다시 쓴다.
// 모양은 Drizzle 쿼리 빌더와 생성된 <모듈>.schema.ts의 표로 만든다: 칸 이름이 틀리면 컴파일 오류다.
// 만들 때 한 번 SQL 글자로 바꿔 두고, 실행은 부를 때 넘긴 연결(트랜잭션이든 아니든)에서 지금의 postgres로 한다.
// Drizzle 클라이언트와 prepare는 쓰지 않는다: 클라이언트는 우리 연결의 날짜 읽기를 문자열로 바꾸고,
// prepare는 만든 순간의 연결을 붙잡아 트랜잭션 안에서 불러도 밖에서 돈다 (2026-11-08 시험, 리팩토링계획 3장).
// 그래서 돌아오는 행은 지금 sql과 같다: 칸 이름은 DB 그대로, 날짜는 Date, bigint는 number.

// 모양을 만드는 조건 · 정렬. 모듈은 drizzle-orm을 직접 가져오지 않고 이것만 쓴다 (모듈 경계 검사)
export { and, asc, desc, eq, gt, gte, isNotNull, isNull, lt, lte, ne, or } from 'drizzle-orm';

/** 템플릿에 넣는 값. 이름은 QueryTemplate.value('이름')의 이름이다 */
type Values = Readonly<Record<string, unknown>>;

/** SQL 글자로 바꿀 수 있는 Drizzle 읽기. 돌려줄 행(result)이 R과 맞는지 컴파일러가 본다 */
interface ReadShape<R> {
  toSQL(): { sql: string; params: unknown[] };
  readonly _: { readonly result: readonly R[]; readonly config: PgSelectConfig };
}

/** 생성된 <모듈>.schema.ts의 표 (TableRepository가 받는 타입) */
export type { PgTable };

/** 공간과 id로 한 줄 읽기 (TableRepository가 표마다 한 번 만든다) */
export type IdRead = QueryTemplate<{ space: string; id: string }, Row>;

export class QueryTemplate<V extends Values, R> {
  private static readonly builder = new QueryBuilder();

  private constructor(
    /** 있는 조건 이름들(정렬, 쉼표) → 그 모양의 SQL. 조건을 고르지 않는 템플릿은 '' 하나 */
    private readonly shapes: ReadonlyMap<string, { text: string; params: unknown[] }>,
    /** 있을 수도 없을 수도 있는 조건의 이름 (정렬) */
    private readonly optional: readonly string[],
  ) {}

  /** 모양이 하나인 읽기 */
  static of<V extends Values, R>(build: (q: QueryBuilder) => ReadShape<R>): QueryTemplate<V, R> {
    return new QueryTemplate(
      new Map([['', QueryTemplate.compile(build(QueryTemplate.builder))]]),
      [],
    );
  }

  /**
   * 있을 수도 없을 수도 있는 조건이 있는 읽기. 조건마다 있고 없는 모든 경우를 지금 만들어 둔다 (조건 셋이면 8개).
   * 값이 null이나 undefined인 조건은 없는 것이다. `(값 IS NULL OR 칸 = 값)`으로 한 모양에 넣지 않는다: 색인을 못 쓴다
   */
  static choose<V extends Values, R>(
    optional: readonly (keyof V & string)[],
    build: (q: QueryBuilder, given: (name: keyof V & string) => boolean) => ReadShape<R>,
  ): QueryTemplate<V, R> {
    const names = [...optional].sort();
    const shapes = new Map<string, { text: string; params: unknown[] }>();
    for (let mask = 0; mask < 1 << names.length; mask++) {
      const present = names.filter((_, i) => mask & (1 << i));
      const shape = build(QueryTemplate.builder, (name) => present.includes(name));
      shapes.set(present.join(','), QueryTemplate.compile(shape));
    }
    return new QueryTemplate(shapes, names);
  }

  /**
   * 표 하나를 공간과 id로 읽는다 (잠그면 FOR UPDATE). TableRepository가 표마다 한 번 만든다.
   * id · space_id 칸이 없는 표는 만들 때 오류: 그 저장소는 select를 SQL로 덮어써야 한다
   */
  static byId(table: PgTable, lock: boolean): IdRead {
    const { id, space_id: space } = table as unknown as Record<string, unknown>;
    if (!is(id, Column) || !is(space, Column))
      throw new Error(
        `${QueryTemplate.nameOf(table)}에는 id · space_id 칸이 없어요. 저장소의 select를 덮어써 주세요`,
      );
    return QueryTemplate.of((q) => {
      const read = q
        .select()
        .from(table)
        .where(
          drizzleSql`${id} = ${QueryTemplate.value('id')} AND ${space} = ${QueryTemplate.value('space')}`,
        );
      return (lock ? read.for('update') : read) as unknown as ReadShape<Row>;
    });
  }

  /** 값이 들어갈 자리. 값은 실행할 때 이 이름으로 넘긴다 */
  static value(name: string) {
    return drizzleSql.placeholder(name);
  }

  /** 칸 값이 목록 중 하나 (`= ANY`). Drizzle의 inArray는 자리를 받으면 `in $1`이 되어 구문 오류다 */
  static anyOf(column: PgColumn, name: string): SQL {
    return drizzleSql`${column} = ANY(${drizzleSql.placeholder(name)})`;
  }

  /** 스키마까지 적은 표 이름 (예: task.goals). 저장 SQL에 쓴다 */
  static nameOf(table: PgTable): string {
    const { schema, name } = getTableConfig(table);
    return schema ? `${schema}.${name}` : name;
  }

  /** 이번 연결에서 실행한다. 빠진 값이 있으면 그 이름과 함께 오류 */
  async rows(sql: Sql, values: V): Promise<R[]> {
    const present = this.optional.filter(
      (name) => values[name] !== null && values[name] !== undefined,
    );
    const shape = this.shapes.get(present.join(','));
    if (!shape) throw new Error(`쿼리 템플릿에 없는 모양: ${present.join(',')}`);
    const params = fillPlaceholders(shape.params, values) as never[];
    return (await sql.unsafe(shape.text, params, { prepare: true })) as unknown as R[];
  }

  /** 행이 하나거나 없을 때 */
  async one(sql: Sql, values: V): Promise<R | null> {
    const [row] = await this.rows(sql, values);
    return row ?? null;
  }

  /**
   * SQL 글자로 바꾼다. 고른 칸은 DB 칸 이름 그대로여야 한다: Drizzle은 고른 칸을 자기 쪽에서 열쇠에 맞춰 주지만
   * 우리는 SQL을 바로 돌려 DB 칸 이름이 행의 열쇠가 된다. 표를 잇는 select()(표마다 묶인 행)도 여기서 막힌다
   */
  private static compile(shape: ReadShape<unknown>): { text: string; params: unknown[] } {
    for (const [key, field] of Object.entries(shape._.config.fields)) {
      if (!is(field, Column) || field.name !== key)
        throw new Error(
          `쿼리 템플릿은 칸을 DB 이름 그대로 고른다: ${key}. 표를 잇거나 모으는 읽기는 sql로 쓴다`,
        );
    }
    const { sql, params } = shape.toSQL();
    return { text: sql, params };
  }
}
