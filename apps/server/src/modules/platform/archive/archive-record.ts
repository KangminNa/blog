import { RuleViolation } from '../base/errors';

// 보관 파일 안의 항목 하나: md의 앞부분과 본문, yml 목록의 항목, graph.json의 행.
// 복원이 읽는 쪽이다. ArchiveFile이 쓰는 모양과 손으로 고친 파일에 흔한 모양(옵시디언의 줄 목록)을 읽고,
// 값의 모양이 틀리면 어느 파일의 무엇이 틀렸는지 알려 복원을 멈춘다.
// 모르는 키는 적힌 글자 그대로 둔다: meta에 보관했다가 다음 내보내기 때 돌려준다 (ArchiveFile.markdown의 kept).
export class ArchiveRecord {
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  private static readonly KEY = /^([^\s#:-][^:]*):(?=\s|$)(.*)$/;
  private static readonly MARKDOWN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n(?:\r?\n)?|$)([\s\S]*)$/;
  private static readonly NUMBER = /^-?\d+(?:\.\d+)?$/;

  private constructor(
    readonly path: string,
    /** 키 → 콜론 뒤의 글자 그대로 (다음 줄까지 이어지면 줄바꿈 포함) */
    private readonly raw: ReadonlyMap<string, string>,
    /** JSON에서 온 값 (raw 대신) */
    private readonly parsed: ReadonlyMap<string, unknown>,
    /** md의 본문. 앞부분 뒤의 빈 줄 하나를 뺀 바이트 그대로 */
    readonly body: string,
  ) {}

  static ofMarkdown(path: string, text: string): ArchiveRecord {
    const found = ArchiveRecord.MARKDOWN.exec(text);
    if (!found) throw new RuleViolation(`${path}: 앞부분(---)이 없어요`);
    const lines = (found[1] ?? '').split(/\r?\n/);
    return new ArchiveRecord(path, ArchiveRecord.keys(path, lines), new Map(), found[2] ?? '');
  }

  /** yml 목록: "- 키: 값"으로 항목이 시작하고 들여 쓴 줄이 이어진다. 빈 목록은 [] */
  static listOfYaml(path: string, text: string): readonly ArchiveRecord[] {
    if (text.trim() === '[]' || text.trim() === '') return [];
    const items: string[][] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      if (line.startsWith('- ')) items.push([line.slice(2)]);
      else if (line.startsWith('  ') && items.length > 0) items.at(-1)?.push(line.slice(2));
      else throw new RuleViolation(`${path}: 읽을 수 없는 줄이에요: ${line.slice(0, 80)}`);
    }
    return items.map(
      (lines) => new ArchiveRecord(path, ArchiveRecord.keys(path, lines), new Map(), ''),
    );
  }

  static ofJson(path: string, value: unknown): ArchiveRecord {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new RuleViolation(`${path}: 항목의 모양이 틀렸어요`);
    return new ArchiveRecord(path, new Map(), new Map(Object.entries(value)), '');
  }

  private static keys(path: string, lines: readonly string[]): ReadonlyMap<string, string> {
    const raw = new Map<string, string>();
    let key: string | null = null;
    for (const line of lines) {
      const found = ArchiveRecord.KEY.exec(line);
      if (found) {
        key = found[1] ?? '';
        if (raw.has(key)) throw new RuleViolation(`${path}: 키가 두 번 있어요: ${key}`);
        raw.set(key, found[2] ?? '');
      } else if (key !== null) {
        raw.set(key, `${raw.get(key)}\n${line}`);
      } else if (line.trim() !== '' && !line.trim().startsWith('#')) {
        throw new RuleViolation(`${path}: 읽을 수 없는 줄이에요: ${line.slice(0, 80)}`);
      }
    }
    return raw;
  }

  /** 틀린 내용을 알리는 오류 */
  problem(message: string): RuleViolation {
    return new RuleViolation(`${this.path}: ${message}`);
  }

  /** 도메인 규칙의 실패에 파일 경로를 붙인다 */
  attempt<T>(work: () => T): T {
    try {
      return work();
    } catch (error) {
      if (error instanceof RuleViolation) throw this.problem(error.message);
      throw error;
    }
  }

  has(key: string): boolean {
    return this.raw.has(key) || this.parsed.has(key);
  }

  text(key: string): string {
    const value = this.optionalText(key);
    if (value === null || value === '') throw this.problem(`${key}이(가) 없어요`);
    return value;
  }

  optionalText(key: string): string | null {
    const value = this.value(key);
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') throw this.problem(`${key}의 모양이 틀렸어요`);
    return String(value);
  }

  oneOf(key: string, allowed: readonly string[]): string {
    const value = this.text(key);
    if (!allowed.includes(value))
      throw this.problem(`${key}은(는) ${allowed.join(' · ')} 중 하나예요: ${value}`);
    return value;
  }

  id(key = 'cairn_id'): string {
    const value = this.optionalId(key);
    if (value === null) throw this.problem(`${key}이(가) 없어요`);
    return value;
  }

  optionalId(key: string): string | null {
    const value = this.optionalText(key);
    if (value !== null && !ArchiveRecord.UUID.test(value))
      throw this.problem(`${key}이(가) id 모양이 아니에요: ${value}`);
    return value;
  }

  /** 글자 목록. 없으면 빈 목록 */
  texts(key: string): readonly string[] {
    const value = this.value(key);
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) throw this.problem(`${key}은(는) 목록이어야 해요`);
    return value.map(String);
  }

  ids(key: string): readonly string[] {
    const values = this.texts(key);
    const bad = values.find((v) => !ArchiveRecord.UUID.test(v));
    if (bad !== undefined) throw this.problem(`${key}에 id 모양이 아닌 값이 있어요: ${bad}`);
    return values;
  }

  date(key: string): Date | null {
    const value = this.optionalText(key);
    if (value === null) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw this.problem(`${key}이(가) 날짜가 아니에요: ${value}`);
    return date;
  }

  number(key: string): number {
    const value = this.optionalNumber(key);
    if (value === null) throw this.problem(`${key}이(가) 없어요`);
    return value;
  }

  optionalNumber(key: string): number | null {
    const value = this.value(key);
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number') throw this.problem(`${key}은(는) 숫자여야 해요`);
    return value;
  }

  flag(key: string, fallback: boolean): boolean {
    const value = this.value(key);
    if (value === null || value === undefined) return fallback;
    if (typeof value !== 'boolean') throw this.problem(`${key}은(는) true나 false여야 해요`);
    return value;
  }

  /** 항목이 만들어진 때: UUIDv7 id의 앞부분 시각. 보관 파일에 없는 생성 시각을 대신한다. 모양이 다르면 지금 */
  get createdAt(): Date {
    const id = this.id();
    if (id[14] !== '7') return new Date();
    return new Date(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16));
  }

  /** 모르는 키들 → 적힌 글자 그대로 */
  unknownKeys(known: ReadonlySet<string>): Readonly<Record<string, string>> {
    return Object.fromEntries([...this.raw].filter(([key]) => !known.has(key)));
  }

  private value(key: string): unknown {
    if (this.parsed.has(key)) return this.parsed.get(key);
    const raw = this.raw.get(key);
    return raw === undefined ? undefined : this.read(key, raw);
  }

  private read(key: string, raw: string): unknown {
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
    const [first] = lines;
    if (first === undefined) return null;
    if (lines.every((l) => l === '-' || l.startsWith('- ')))
      return lines.map((l) => this.scalar(key, l.slice(1).trim()));
    return lines.length === 1 ? this.scalar(key, first) : raw.trim();
  }

  private scalar(key: string, text: string): unknown {
    if (text === 'null' || text === '~' || text === '') return null;
    if (text === 'true' || text === 'false') return text === 'true';
    if (ArchiveRecord.NUMBER.test(text)) return Number(text);
    if (text.startsWith('[')) return this.flowList(key, text);
    if (text.startsWith("'") && text.endsWith("'") && text.length > 1)
      return text.slice(1, -1).replaceAll("''", "'");
    if (!text.startsWith('"')) return text;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw this.problem(`${key}의 따옴표가 맞지 않아요`);
    }
  }

  /** [a, "b, c", 다]: 따옴표 밖의 쉼표로 나눈다 */
  private flowList(key: string, text: string): unknown[] {
    if (!text.endsWith(']')) throw this.problem(`${key}의 목록이 닫히지 않았어요`);
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    const items: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '"' && inner[i - 1] !== '\\') quoted = !quoted;
      if (c === ',' && !quoted) {
        items.push(current);
        current = '';
      } else current += c;
    }
    items.push(current);
    return items.map((item) => this.scalar(key, item.trim()));
  }
}
