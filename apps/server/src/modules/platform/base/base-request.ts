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

  /** 없거나 null이거나 빈 문자열이면 null (화면에서 비운 칸) */
  optionalText(name: string, maxLength: number): string | null {
    const value = this.source[name];
    return value === undefined || value === null || value === ''
      ? null
      : this.text(name, maxLength);
  }

  uuid(name: string): string {
    const value = this.text(name, 36);
    if (value && !RequestFields.UUID.test(value))
      return this.fail(name, 'UUID 형식이어야 해요', '');
    return value.toLowerCase();
  }

  /** 참·거짓 (화면의 켜기·끄기) */
  boolean(name: string): boolean {
    const value = this.source[name];
    if (typeof value !== 'boolean') return this.fail(name, 'true나 false여야 해요', false);
    return value;
  }

  /** 정수. 범위를 벗어나면 틀린 필드로 모인다 */
  integer(name: string, min: number, max: number): number {
    const value = this.source[name];
    if (typeof value !== 'number' || !Number.isInteger(value))
      return this.fail(name, '정수여야 해요', min);
    if (value < min || value > max) return this.fail(name, `${min}~${max} 사이여야 해요`, min);
    return value;
  }

  /** 문자열 목록 (예: 돌려보낼 주소들, 권한들). 없으면 null */
  optionalTextList(name: string, maxItems: number, maxLength: number): readonly string[] | null {
    const value = this.source[name];
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value)) return this.fail(name, '문자열 목록이어야 해요', null);
    if (value.length > maxItems) return this.fail(name, `${maxItems}개 이하여야 해요`, null);
    const bad = value.findIndex(
      (v) => typeof v !== 'string' || v.length === 0 || v.length > maxLength,
    );
    if (bad >= 0) return this.fail(`${name}.${bad}`, `1~${maxLength}자 문자열이어야 해요`, null);
    return value as string[];
  }

  /** 문자열 값만 담은 객체 (예: 설정 이름 → 값). 빈 문자열은 허용한다 (지우기) */
  textMap(name: string, maxLength: number): ReadonlyMap<string, string> {
    const record = this.optionalRecord(name);
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(record)) {
      if (typeof value !== 'string') this.fail(`${name}.${key}`, '문자열이어야 해요', '');
      else if (value.length > maxLength)
        this.fail(`${name}.${key}`, `${maxLength}자 이하여야 해요`, '');
      else map.set(key, value);
    }
    return map;
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

  /** 위의 읽기로 잡을 수 없는 모양 문제를 알린다 (예: 풀리지 않는 확인값) */
  reject(name: string, problem: string): void {
    this.fail(name, problem, null);
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
