// 모듈 사이에 "무슨 일이 있었다"를 알리는 메시지. Entity가 기록하고, Repository가 저장할 때 outbox에 남긴다.
// 이름은 `<모듈>.<데이터>.<과거형>` (예: vault.session.saved). 내용을 바꾸면 version을 올린다.
export class DomainEvent {
  private static readonly NAME = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;

  constructor(
    readonly name: string,
    readonly version: number,
    readonly spaceId: string,
    readonly data: Readonly<Record<string, unknown>>,
  ) {
    if (!DomainEvent.NAME.test(name)) throw new Error(`이벤트 이름 형식이 아니에요: ${name}`);
  }

  /** outbox 행에서 되살린다 (일꾼이 Handler에 넘길 때) */
  static fromOutbox(
    topic: string,
    spaceId: string,
    payload: Readonly<Record<string, unknown>>,
  ): DomainEvent {
    const { v, ...data } = payload;
    return new DomainEvent(topic, typeof v === 'number' ? v : 1, spaceId, data);
  }

  /** `vault.*`, `blog.post.*`, `*` 같은 받을 이벤트 무늬와 맞는가 */
  matches(pattern: string): boolean {
    if (pattern === '*' || pattern === this.name) return true;
    return pattern.endsWith('.*') && this.name.startsWith(pattern.slice(0, -1));
  }

  toJSON(): object {
    return { name: this.name, v: this.version, spaceId: this.spaceId, data: this.data };
  }
}
