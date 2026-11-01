import { BaseEntity } from '../platform';

// task 모듈의 엔티티 기반 (새 파일 구조 시범, 객체설계 6장). 바뀐 열을 기억해 Repository가 그 열만 저장한다.
// 단순한 칸은 set으로 바꾸고, 상태는 규칙을 지키는 메서드로만 바꾼다. 둘 다 track으로 적는다.
export abstract class TrackedEntity extends BaseEntity {
  private readonly dirty = new Map<string, unknown>();

  /** 저장할 열 이름 → 새 값 */
  get changes(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.dirty);
  }

  get changed(): boolean {
    return this.dirty.size > 0;
  }

  /** 저장이 끝난 뒤 Repository가 부른다 */
  clearChanges(): void {
    this.dirty.clear();
  }

  protected track(column: string, value: unknown): void {
    this.dirty.set(column, value);
  }
}
