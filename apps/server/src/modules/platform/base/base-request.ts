import { InvalidRequest } from './errors';

// 유스케이스 입력의 기반. `static from(raw)`에서 모양(필드 유무, 자료형, 길이)만 검사한다.
// 의미 검사(예: 도구 이름 규칙)는 도메인이 한다.
//
//   static from(raw: unknown) {
//     return BaseRequest.read(raw, (f) => new SaveSessionRequest(f.uuid('requestId'), f.text('title', 200)));
//   }
// biome-ignore lint/complexity/noStaticOnlyClass: 모든 Request의 공통 부모. 인스턴스 필드는 하위 클래스가 가진다
export abstract class BaseRequest {
  protected static read<R>(raw: unknown, build: (fields: RequestFields) => R): R {
    const fields = new RequestFields(raw);
    const request = build(fields);
    fields.throwIfInvalid();
    return request;
  }
}

/** raw(JSON)에서 필드를 꺼낸다. 틀린 필드는 모아 두었다가 한 번에 InvalidRequest로 알린다 */
export class RequestFields {
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  private readonly source: Readonly<Record<string, unknown>>;

  constructor(
    raw: unknown,
    private readonly prefix = '',
    private readonly problems = new Map<string, string>(),
  ) {
    const isObject = typeof raw === 'object' && raw !== null && !Array.isArray(raw);
    if (!isObject) this.problems.set(prefix || '(본문)', '객체여야 해요');
    this.source = isObject ? (raw as Record<string, unknown>) : {};
  }

  /** 필수 문자열. 앞뒤 공백은 그대로 둔다 */
  text(name: string, maxLength: number): string {
    const value = this.source[name];
    if (typeof value !== 'string' || value.length === 0)
      return this.fail(name, '필수 문자열이에요', '');
    if (value.length > maxLength) return this.fail(name, `${maxLength}자 이하여야 해요`, '');
    return value;
  }

  optionalText(name: string, maxLength: number): string | null {
    return this.source[name] === undefined || this.source[name] === null
      ? null
      : this.text(name, maxLength);
  }

  uuid(name: string): string {
    const value = this.text(name, 36);
    if (value && !RequestFields.UUID.test(value))
      return this.fail(name, 'UUID 형식이어야 해요', '');
    return value.toLowerCase();
  }

  optionalDate(name: string): Date | null {
    const value = this.optionalText(name, 40);
    if (value === null) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? this.fail(name, 'ISO 8601 날짜여야 해요', null) : date;
  }

  /** 안쪽 객체. 같은 방식으로 읽고, 틀린 필드는 `바깥.안쪽` 이름으로 함께 모인다 */
  nested(name: string): RequestFields {
    return new RequestFields(this.source[name], this.key(name), this.problems);
  }

  /** 모르는 키도 버리지 않는 자유 형식 객체 (도구별 추가 정보 등) */
  optionalRecord(name: string): Readonly<Record<string, unknown>> {
    const value = this.source[name];
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value))
      return this.fail(name, '객체여야 해요', {});
    return value as Record<string, unknown>;
  }

  throwIfInvalid(): void {
    if (this.problems.size > 0) throw new InvalidRequest(this.problems);
  }

  private fail<T>(name: string, problem: string, fallback: T): T {
    this.problems.set(this.key(name), problem);
    return fallback;
  }

  private key(name: string): string {
    return this.prefix ? `${this.prefix}.${name}` : name;
  }
}
