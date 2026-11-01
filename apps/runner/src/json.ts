/**
 * 서버와 AI CLI가 보낸 JSON을 읽는다. 없는 칸은 빈 값으로 돌려주어, 모양이 조금 달라도 러너가 멈추지 않게 한다.
 * AI CLI의 출력은 공개된 약속이 아니라 칸이 늘거나 줄 수 있다.
 */
export class Json {
  private constructor(private readonly value: Readonly<Record<string, unknown>>) {}

  static of(raw: unknown): Json {
    const isObject = typeof raw === 'object' && raw !== null && !Array.isArray(raw);
    return new Json(isObject ? (raw as Record<string, unknown>) : {});
  }

  /** 한 줄을 읽는다. JSON 객체가 아니면 null */
  static parse(line: string): Json | null {
    try {
      const raw: unknown = JSON.parse(line);
      return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? Json.of(raw) : null;
    } catch {
      return null;
    }
  }

  text(name: string): string {
    const value = this.value[name];
    return typeof value === 'string' ? value : '';
  }

  optionalText(name: string): string | null {
    return this.text(name) || null;
  }

  number(name: string): number {
    const value = this.value[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  /** 없거나 숫자가 아니면 null */
  optionalNumber(name: string): number | null {
    const value = this.value[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  flag(name: string): boolean {
    return this.value[name] === true;
  }

  child(name: string): Json {
    return Json.of(this.value[name]);
  }

  /** 객체 목록. 객체가 아닌 항목은 뺀다 */
  list(name: string): readonly Json[] {
    const value = this.value[name];
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => typeof item === 'object' && item !== null && !Array.isArray(item))
      .map((item) => Json.of(item));
  }

  /** 문자열 목록. 문자열이 아닌 항목은 뺀다 */
  texts(name: string): readonly string[] {
    const value = this.value[name];
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  }

  /** 객체의 값들 (키가 정해지지 않은 표, 예: 모델별 사용량) */
  values(): readonly Json[] {
    return Object.values(this.value).map((item) => Json.of(item));
  }
}
