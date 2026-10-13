import { createHash } from 'node:crypto';
import { RuleViolation } from '../../platform';

/** 민감정보를 지운 자리 하나. 값은 남기지 않고 어느 칸에서 무엇을 지웠는지만 */
export class Redaction {
  static readonly SECRET = 'secret';

  constructor(
    readonly section: string,
    readonly label: string,
  ) {}

  static restore(raw: Readonly<Record<string, unknown>>): Redaction {
    return new Redaction(String(raw.section ?? ''), String(raw.label ?? ''));
  }

  toJSON(): object {
    return { kind: Redaction.SECRET, section: this.section, label: this.label };
  }
}

// 세션 노트: 판 하나의 내용. 제목, 태그, 고정 칸 다섯(한 일 · 결정 · 막힌 점 · 인용 · 기타).
// 칸 이름과 소제목은 보관 형식(docs/보관형식.md)의 고정 소제목과 같다. 칸 구성을 바꾸면 SCHEMA를 올린다.
// 판은 고칠 수 없으므로, 민감정보는 노트가 판이 되기 전에 지운다 (SensitivePolicy).
export class SessionNote {
  static readonly SCHEMA = 1;
  /** 칸 이름 → md 소제목 */
  static readonly SECTIONS: ReadonlyArray<readonly [string, string]> = [
    ['did', '한 일'],
    ['decisions', '결정'],
    ['blocked', '막힌 점'],
    ['quotes', '인용'],
    ['extra', '기타'],
  ];
  /** 인용은 핵심 원문만: 넘으면 AI가 줄여서 다시 보낸다 */
  static readonly QUOTES_MAX = 4_000;
  static readonly SECTION_MAX = 20_000;

  private constructor(
    readonly title: string,
    readonly tags: readonly string[],
    private readonly sections: ReadonlyMap<string, string>,
    readonly redactions: readonly Redaction[],
  ) {}

  /** AI 도구가 보낸 노트. 앞뒤 공백은 지우고, 태그는 겹치지 않게 */
  static write(
    title: string,
    tags: readonly string[],
    sections: ReadonlyMap<string, string>,
  ): SessionNote {
    const filled = new Map(
      SessionNote.SECTIONS.map(([name]) => [name, (sections.get(name) ?? '').trim()]),
    );
    const note = new SessionNote(
      title.trim(),
      [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
      filled,
      [],
    );
    if (!note.title) throw new RuleViolation('제목을 써 주세요');
    if ([...filled.values()].every((text) => !text))
      throw new RuleViolation('한 일 · 결정 · 막힌 점 · 인용 · 기타 중 하나는 써 주세요');
    return note;
  }

  /** 판(session_revisions)의 sections·redactions 열에서 */
  static restore(
    sections: Readonly<Record<string, unknown>>,
    redactions: readonly Readonly<Record<string, unknown>>[] | null,
  ): SessionNote {
    return new SessionNote(
      String(sections.title ?? ''),
      Array.isArray(sections.tags) ? sections.tags.map(String) : [],
      new Map(SessionNote.SECTIONS.map(([name]) => [name, String(sections[name] ?? '')])),
      (redactions ?? []).map((r) => Redaction.restore(r)),
    );
  }

  section(name: string): string {
    return this.sections.get(name) ?? '';
  }

  /**
   * 제목과 각 칸의 글을 고쳐 쓴 새 노트 (민감정보 지우기). rewrite는 칸 이름('title' 포함)과 글을 받아
   * 고친 글과 그 칸에서 지운 것들을 돌려준다.
   */
  rewrite(
    change: (section: string, text: string) => readonly [string, readonly Redaction[]],
  ): SessionNote {
    const found: Redaction[] = [...this.redactions];
    const apply = (section: string, text: string): string => {
      const [next, removed] = change(section, text);
      found.push(...removed);
      return next;
    };
    const title = apply('title', this.title);
    const sections = new Map([...this.sections].map(([name, text]) => [name, apply(name, text)]));
    return new SessionNote(title, this.tags, sections, found);
  }

  /** 판의 sections 열 (칸 이름 → 글). title·tags도 칸으로 함께 둔다 */
  toJSON(): Record<string, unknown> {
    return { title: this.title, tags: this.tags, ...Object.fromEntries(this.sections) };
  }

  /** 칸마다 해시. 나중에 사람이 고친 칸과 새 원본을 칸 단위로 합칠 때 쓴다 */
  sectionHashes(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.toJSON()).map(([name, value]) => [
        name,
        SessionNote.sha(JSON.stringify(value)),
      ]),
    );
  }

  /** 내용 전체의 해시. 같으면 같은 판이다 (`UNIQUE (session_id, content_hash)`) */
  get hash(): string {
    return SessionNote.sha(JSON.stringify([SessionNote.SCHEMA, this.toJSON()]));
  }

  /** 본문 md: 내용이 있는 칸만 고정 소제목으로. 제목·태그는 보관 파일의 앞부분(frontmatter)에 들어간다 */
  toMarkdown(): string {
    return SessionNote.SECTIONS.filter(([name]) => this.section(name))
      .map(([name, heading]) => `## ${heading}\n\n${this.section(name)}\n`)
      .join('\n');
  }

  private static sha(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }
}
