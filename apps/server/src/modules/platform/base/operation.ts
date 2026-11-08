import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import type { Actor } from './actor';
import { BaseRequest, type RequestFields } from './base-request';
import type { ToolAnswer } from './base-tool';
import type { Sql } from './database';
import type { DomainEvent } from './event';
import { type Changes, type How, type RowOf, TableWriter, type Where } from './table-query';

/** 동작의 입력 읽기: BaseRequest와 같은 칸 읽기 · 틀린 칸 모으기 */
// biome-ignore lint/complexity/noStaticOnlyClass: BaseRequest.read를 동작에 여는 창구
class OperationInput extends BaseRequest {
  static of<R>(raw: unknown, build: (fields: RequestFields) => R): R {
    return BaseRequest.read(raw, build);
  }
}

// 동작 하나 (리팩토링계획 3장의 Operation: Command · Read). 기능 패키지의 서버 코드가 이것을 상속한다.
// 입구(REST · MCP)를 모른다: 입구는 목록 파일의 api · tools가 동작 이름으로 가리키고, 코어가 연다.
// 순서는 어디나 같다: 권한(allow) → 입력 모양(input) → 일(run, 쓰기면 트랜잭션 하나 안에서) → View.
// 순서는 코어(OperationRunner)가 한 곳에서 지키고, 동작은 판단과 표 읽기 · 쓰기만 적는다.
export abstract class Operation<I = unknown> {
  /** 누구나 (방문자 포함) */
  static readonly ANYONE = 'anyone';
  /** 주인만 (관리 일) */
  static readonly OWNER = 'owner';

  /** 패키지 안에서 유일한 이름. 목록 파일의 api · tools가 이 이름으로 가리킨다 */
  abstract readonly name: string;
  /** 부를 수 있는 사람: Operation.OWNER · Operation.ANYONE · Actor의 권한 이름 (예: Actor.RUN) */
  abstract readonly allow: string;
  /** 쓰기인가. 쓰기는 트랜잭션 하나 안에서 돌고, 남긴 이벤트는 같은 트랜잭션의 outbox로 */
  abstract readonly writes: boolean;

  /** 입력 모양 검사 (BaseRequest처럼 틀린 칸을 모아 InvalidRequest). 경로의 :id도 여기로 온다 */
  abstract input(raw: unknown): I;

  abstract run(work: Work, actor: Actor, input: I): Promise<ToolAnswer>;

  /** 입력의 칸을 읽는다 (틀린 칸을 모아 InvalidRequest). input()에서 쓴다 */
  protected fields<R>(raw: unknown, build: (fields: RequestFields) => R): R {
    return OperationInput.of(raw, build);
  }

  /** 권한 확인. 코어가 입력을 읽기 전에 부른다 */
  check(actor: Actor): void {
    if (this.allow === Operation.OWNER) actor.assertOwner();
    else if (this.allow !== Operation.ANYONE) actor.assertCan(this.allow);
  }
}

/** 읽기 동작 */
export abstract class Read<I = unknown> extends Operation<I> {
  readonly writes = false;
}

/** 쓰기 동작 (트랜잭션 하나) */
export abstract class Command<I = unknown> extends Operation<I> {
  readonly writes = true;
}

/**
 * 동작이 일하는 자리: 자기 스키마의 표만 조건 규칙으로 읽고 쓰고, 이벤트를 남긴다.
 * 그 기능만의 쿼리(표 잇기 · 모으기)는 work.sql로 쓴다 (자기 스키마만: pnpm check가 본다).
 * 다른 스키마의 표를 넘기면 실행 전에 막는다: 패키지는 코어 표에 쓰지 않는다 (리팩토링계획 7장).
 */
export class Work extends TableWriter {
  /** 이 일에서 남긴 이벤트. 쓰기 동작이 끝나면 코어가 같은 트랜잭션의 outbox에 넣는다 */
  readonly events: DomainEvent[] = [];

  constructor(
    /** 이번 연결 (쓰기면 트랜잭션) */
    readonly sql: Sql,
    /** 패키지의 스키마. 없으면 표를 쓸 수 없다 */
    private readonly schema: string | null,
  ) {
    super();
  }

  override rows<T extends PgTable>(
    table: T,
    where: Where<RowOf<T>>,
    how?: How<RowOf<T>>,
  ): Promise<RowOf<T>[]> {
    this.own(table);
    return super.rows(table, where, how);
  }

  override row<T extends PgTable>(
    table: T,
    where: Where<RowOf<T>>,
    how?: How<RowOf<T>>,
  ): Promise<RowOf<T> | null> {
    this.own(table);
    return super.row(table, where, how);
  }

  override exists<T extends PgTable>(table: T, where: Where<RowOf<T>>): Promise<boolean> {
    this.own(table);
    return super.exists(table, where);
  }

  override insertRows<T extends PgTable>(
    table: T,
    rows: Partial<RowOf<T>> | readonly Partial<RowOf<T>>[],
  ): Promise<void> {
    this.own(table);
    return super.insertRows(table, rows);
  }

  override updateRows<T extends PgTable>(
    table: T,
    changes: Changes<RowOf<T>>,
    where: Where<RowOf<T>>,
  ): Promise<number> {
    this.own(table);
    return super.updateRows(table, changes, where);
  }

  override deleteRows<T extends PgTable>(table: T, where: Where<RowOf<T>>): Promise<number> {
    this.own(table);
    return super.deleteRows(table, where);
  }

  override pageOf<R>(
    rows: readonly R[],
    size: number,
    cursorOf: (last: R) => string | null,
  ): { items: R[]; next: string | null } {
    return super.pageOf(rows, size, cursorOf);
  }

  /** 이벤트를 남긴다 (쓰기 동작만. 커밋과 함께 나간다) */
  record(event: DomainEvent): void {
    this.events.push(event);
  }

  private own(table: PgTable): void {
    const schema = getTableConfig(table).schema ?? 'public';
    if (schema !== this.schema)
      throw new Error(`기능 패키지는 자기 스키마(${this.schema ?? '없음'})의 표만 써요: ${schema}`);
  }
}
