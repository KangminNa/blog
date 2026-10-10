import { randomBytes } from 'node:crypto';
import type { DomainEvent } from './event';

// 도메인 객체의 기반. id와 버전(낙관적 잠금), 그리고 저장할 때 내보낼 이벤트를 가진다.
// 하위 클래스는 `static open()`(새로 만들기)과 `static restore()`(DB 행에서 되살리기)로만 만든다.
export abstract class BaseEntity {
  private readonly events: DomainEvent[] = [];

  protected constructor(
    readonly id: string,
    private loadedVersion: number,
  ) {}

  /** 불러올 때의 버전. 저장할 때 이 값과 DB 값이 같아야 한다 */
  get version(): number {
    return this.loadedVersion;
  }

  /** 저장이 끝난 뒤 Repository가 부른다 */
  markSaved(newVersion: number): void {
    this.loadedVersion = newVersion;
  }

  protected record(event: DomainEvent): void {
    this.events.push(event);
  }

  /** 쌓인 이벤트를 꺼내고 비운다. Repository가 저장할 때 부른다 */
  pullEvents(): DomainEvent[] {
    return this.events.splice(0);
  }

  /** 시간순으로 정렬되는 UUIDv7 */
  protected static newId(): string {
    const bytes = randomBytes(16);
    const ms = BigInt(Date.now());
    for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
