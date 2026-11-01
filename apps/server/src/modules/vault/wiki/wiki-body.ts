import { createHash } from 'node:crypto';

/** wiki 본문의 칸 하나: md 제목(##) 하나 아래의 글 */
export class WikiSection {
  /** 첫 제목 앞의 글이 들어가는 칸 */
  static readonly LEAD = '_lead';

  constructor(
    readonly key: string,
    readonly title: string,
    readonly body: string,
  ) {}

  get hash(): string {
    return WikiBody.sha(this.body);
  }

  toJSON(): object {
    return { key: this.key, title: this.title, body: this.body };
  }
}

// wiki 판 하나의 본문: md 원문과 그것을 ## 제목으로 나눈 칸들 (2026-10-10 결정).
// 칸은 사람이 고친 곳을 AI가 덮지 않게 하는 단위다. 칸 이름(key)은 제목 그대로이고, 같은 제목이 또 나오면 뒤에 번호를 붙인다.
// 코드 블록 안의 ##은 제목이 아니다.
export class WikiBody {
  static readonly MAX = 100_000;
  private static readonly FENCE = /^ {0,3}(```|~~~)/;
  private static readonly HEADING = /^## +(.+?)\s*#*\s*$/;

  private constructor(
    /** md 원문. 줄바꿈은 \n으로 맞춘다 */
    readonly markdown: string,
    readonly sections: readonly WikiSection[],
  ) {}

  static parse(markdown: string): WikiBody {
    const text = markdown.replace(/\r\n?/g, '\n');
    const found: [string, string, string[]][] = [[WikiSection.LEAD, '', []]];
    const seen = new Set<string>([WikiSection.LEAD]);
    let fenced = false;
    for (const line of text.split('\n')) {
      if (WikiBody.FENCE.test(line)) fenced = !fenced;
      const title = fenced ? null : (WikiBody.HEADING.exec(line)?.[1] ?? null);
      if (title === null) {
        found.at(-1)?.[2].push(line);
        continue;
      }
      let key = title;
      for (let n = 2; seen.has(key); n++) key = `${title} ${n}`;
      seen.add(key);
      found.push([key, title, []]);
    }
    const sections = found
      .map(([key, title, lines]) => new WikiSection(key, title, lines.join('\n').trim()))
      .filter((s) => s.key !== WikiSection.LEAD || s.body !== '');
    return new WikiBody(text, sections);
  }

  static sha(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  get hash(): string {
    return WikiBody.sha(this.markdown);
  }

  /** 칸 이름 → 글의 해시 (wiki_revisions.section_hashes) */
  sectionHashes(): Record<string, string> {
    return Object.fromEntries(this.sections.map((s) => [s.key, s.hash]));
  }

  /** 다른 본문과 비교해 바뀐 칸들: 글이 달라졌거나, 새로 생겼거나, 없어진 칸 */
  changedFrom(other: WikiBody): readonly string[] {
    const before = other.sectionHashes();
    const after = this.sectionHashes();
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (key) => before[key] !== after[key],
    );
  }

  sameAs(other: WikiBody): boolean {
    return this.markdown === other.markdown;
  }
}
