import { createHash } from 'node:crypto';
import { Redaction, RuleViolation, type SensitivePolicy } from '../../platform';
import type { SessionRevisionNew, SessionRevisionRow } from '../vault.tables';

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
  /** 제목 · 태그의 길이와 태그 수 (save_session의 입력과 같다) */
  static readonly TITLE_MAX = 200;
  static readonly TAG_MAX = 40;
  static readonly TAGS_MAX = 20;

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

  /**
   * 서버 러너의 답에서 (지시문 틀 session-note: JSON 한 덩어리, 2차 4단계). 칸은 글이나 글 목록(줄마다 "- "),
   * 길면 자른다 (다시 보내 달라고 할 AI가 없다). JSON이 아니거나 제목 · 내용이 없으면 RuleViolation
   */
  static fromAnswer(answer: string): SessionNote {
    const start = answer.indexOf('{');
    const json =
      start < 0 ? null : SessionNote.parsed(answer.slice(start, answer.lastIndexOf('}') + 1));
    if (json === null) throw new RuleViolation('노트를 JSON으로 읽지 못했어요');
    const text = (value: unknown, max: number): string => {
      const items = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : null;
      const joined = items ? items.map((v) => `- ${v.trim()}`).join('\n') : value;
      return typeof joined === 'string' ? joined.trim().slice(0, max) : '';
    };
    const tags = Array.isArray(json.tags) ? json.tags.filter((t) => typeof t === 'string') : [];
    return SessionNote.write(
      text(json.title, SessionNote.TITLE_MAX),
      tags.slice(0, SessionNote.TAGS_MAX).map((t) => t.slice(0, SessionNote.TAG_MAX)),
      new Map(
        SessionNote.SECTIONS.map(([name]) => [
          name,
          text(json[name], name === 'quotes' ? SessionNote.QUOTES_MAX : SessionNote.SECTION_MAX),
        ]),
      ),
    );
  }

  private static parsed(text: string): Record<string, unknown> | null {
    try {
      const value: unknown = JSON.parse(text);
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /** 판(session_revisions)의 sections·redactions 칸에서 */
  static restore(revision: Pick<SessionRevisionRow, 'sections' | 'redactions'>): SessionNote {
    const sections = revision.sections as Readonly<Record<string, unknown>>;
    const redactions = revision.redactions as readonly Readonly<Record<string, unknown>>[] | null;
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

  /** 제목과 모든 칸에서 민감정보를 지운 새 노트. 지운 것은 redactions에 쌓인다 */
  scrubbedBy(policy: SensitivePolicy): SessionNote {
    return this.rewrite((section, text) => policy.scrub(section, text));
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

  /** 판(session_revisions)에 적는 노트의 칸: 본문 md, 칸들, 칸 구성, 해시, 지운 자리(없으면 null) */
  revision(): Pick<
    SessionRevisionNew,
    'body_md' | 'sections' | 'sections_schema' | 'section_hashes' | 'content_hash' | 'redactions'
  > {
    return {
      body_md: this.toMarkdown(),
      sections: this.toJSON(),
      sections_schema: SessionNote.SCHEMA,
      section_hashes: this.sectionHashes(),
      content_hash: this.hash,
      redactions: this.redactions.length > 0 ? this.redactions.map((r) => r.toJSON()) : null,
    };
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
