import { BaseEntity } from './base-entity';

/** 표 한 줄이 공통으로 갖는 칸 */
export interface TableRow {
  id: string;
  version?: number;
}

/** 칸마다의 규칙: 들어온 값을 검사해 저장할 값을 돌려준다. 여기 없는 칸은 밖에서 바꿀 수 없다 */
export type ColumnRules<R> = { readonly [K in keyof R]?: (value: R[K]) => R[K] };

// 표 한 줄을 들고 있는 엔티티의 기반. 행은 안에 숨기고 밖에는 동작과 view만 내놓는다.
// 칼럼이 늘어도 하위 클래스의 생성자, restore, Repository, Service는 그대로다.
//   R: 표 인터페이스, N: 새 행에 꼭 적어야 하는 칸 (둘 다 <모듈>.tables.ts)
export abstract class TableEntity<R extends TableRow, N extends TableRow = R> extends BaseEntity {
  private current: R;
  private fresh: boolean;
  private readonly dirty = new Map<keyof R, unknown>();

  protected constructor(row: R | N, fresh = false) {
    super(row.id, row.version ?? 1);
    this.current = row as R;
    this.fresh = fresh;
  }

  /** 행은 읽기만 된다. 바꾸는 길은 put과 accept뿐이다 */
  protected get row(): Readonly<R> {
    return this.current;
  }

  /** 칸 하나를 적는다. 저장할 때 적은 칸만 나간다 */
  protected put<K extends keyof R>(column: K, value: R[K]): void {
    this.current = { ...this.current, [column]: value };
    this.dirty.set(column, value);
  }

  /** 들어온 칸을 규칙에 통과시켜 적는다. undefined는 그대로 둔다는 뜻이다 */
  protected accept(changes: Partial<R>, rules: ColumnRules<R>): void {
    for (const column of Object.keys(changes) as (keyof R)[]) {
      const value = changes[column];
      if (value === undefined) continue;
      const rule = rules[column] as ((value: unknown) => R[keyof R]) | undefined;
      if (!rule) throw new Error(`밖에서 바꿀 수 없는 칸: ${String(column)}`);
      this.put(column, rule(value));
    }
  }

  get isNew(): boolean {
    return this.fresh;
  }

  /** 저장할 칸. 새 행이면 전부, 아니면 바뀐 칸만. Repository가 부른다 */
  get unsaved(): Partial<R> {
    return this.fresh ? this.current : (Object.fromEntries(this.dirty) as Partial<R>);
  }

  /** 저장이 끝난 뒤 Repository가 부른다. DB가 채운 칸까지 받는다 */
  saved(row: R): void {
    this.current = { ...this.current, ...row };
    this.fresh = false;
    this.dirty.clear();
    this.markSaved(this.current.version ?? this.version);
  }
}
