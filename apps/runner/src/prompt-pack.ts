import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillPackage } from './job';
import type { RunLog } from './redactor';

// 러너가 AI에게 주는 지시문의 글 (2차 1-0, 기획서 결정 2026-11-14). 글은 코드에 두지 않고 러너 스킬 cairn-runner의 틀에 둔다:
// 서버가 일마다 그 스킬의 지금 판(주인이 스킬 메뉴에서 고친 판이 있으면 그것)을 보내고, 없거나 읽지 못하면 러너의 skills/ 판을 쓴다.
// 코드는 어느 단락을 어떤 순서로 넣을지와 값만 정한다.
//
// 틀의 문법 (references/*.md):
//   <!-- 이름 -->        이 줄부터 다음 표시 전까지가 틀 하나 (앞뒤 빈 줄은 뺀다). 첫 표시 앞의 글은 사람이 읽는 설명
//   {{자리}}             값을 그대로 넣는다 (값 속의 {{ }}는 다시 읽지 않는다)
//   {{#자리}}…{{/자리}}  값이 있을 때만, {{^자리}}…{{/자리}} 값이 없을 때만 (없음: 빈 글 · 0 · false · null)
//   여닫는 표시만 있는 줄은 줄째 빠진다

/** 틀에 넣는 값 */
export type PromptValues = Readonly<Record<string, string | number | boolean | null>>;

/** 틀을 읽지 못함 (짝이 맞지 않는 표시, 같은 이름의 틀) */
export class PromptProblem extends Error {}

/** 틀 한 조각: 글(mark ''), 값(=), 여는 표시(# · ^), 닫는 표시(/) */
class PromptToken {
  constructor(
    readonly mark: string,
    readonly text: string,
  ) {}
}

export class PromptTemplate {
  private static readonly TAG = /\{\{([#^/]?)([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
  private static readonly STANDALONE = /^[ \t]*(\{\{[#^/][a-zA-Z][a-zA-Z0-9]*\}\})[ \t]*\n/gm;

  private constructor(
    readonly name: string,
    private readonly tokens: readonly PromptToken[],
  ) {}

  static parse(name: string, body: string): PromptTemplate {
    const source = `${body}\n`.replace(PromptTemplate.STANDALONE, '$1');
    const tokens: PromptToken[] = [];
    const open: string[] = [];
    let last = 0;
    for (const match of source.matchAll(PromptTemplate.TAG)) {
      const [whole, mark = '', key = ''] = match;
      if (match.index > last) tokens.push(new PromptToken('', source.slice(last, match.index)));
      if (mark === '/' && open.pop() !== key)
        throw new PromptProblem(`${name}: {{/${key}}}의 여는 표시가 없어요`);
      if (mark === '#' || mark === '^') open.push(key);
      tokens.push(new PromptToken(mark || '=', key));
      last = match.index + whole.length;
    }
    if (last < source.length) tokens.push(new PromptToken('', source.slice(last)));
    if (open.length > 0) throw new PromptProblem(`${name}: {{#${open.at(-1)}}}가 닫히지 않았어요`);
    return new PromptTemplate(name, tokens);
  }

  /** 값을 넣은 글. 마지막 줄바꿈 하나는 뺀다 (틀의 끝) */
  fill(values: PromptValues): string {
    let out = '';
    const shown: boolean[] = [];
    for (const token of this.tokens) {
      const on = shown.every(Boolean);
      if (token.mark === '') {
        if (on) out += token.text;
      } else if (token.mark === '=') {
        if (on) out += String(values[token.text] ?? '');
      } else if (token.mark === '/') shown.pop();
      else shown.push(on && PromptTemplate.present(values[token.text]) === (token.mark === '#'));
    }
    return out.endsWith('\n') ? out.slice(0, -1) : out;
  }

  private static present(value: string | number | boolean | null | undefined): boolean {
    return value !== null && value !== undefined && value !== '' && value !== 0 && value !== false;
  }
}

/** 지시문 틀 한 벌. 이름으로 글을 채운다 */
export class PromptPack {
  static readonly SKILL = 'cairn-runner';
  private static readonly MARK = /^<!-- ([a-z][a-z0-9-]*) -->$/;

  private constructor(
    /** 어디서 온 판인가 (로그) */
    readonly source: string,
    private readonly templates: ReadonlyMap<string, PromptTemplate>,
    /** 이 판에 없는 틀을 찾을 판 (러너와 서버의 판이 어긋날 때) */
    private readonly fallback: PromptPack | null = null,
  ) {}

  /** 스킬 파일들(경로 → 글)의 references/*.md에서 틀을 읽는다 */
  static parse(source: string, files: ReadonlyMap<string, string>): PromptPack {
    const templates = new Map<string, PromptTemplate>();
    const paths = [...files.keys()].filter((p) => /^references\/[^/]+\.md$/.test(p)).sort();
    for (const path of paths) {
      let name: string | null = null;
      let lines: string[] = [];
      const flush = () => {
        if (name === null) return;
        if (templates.has(name)) throw new PromptProblem(`같은 이름의 틀이 둘이에요: ${name}`);
        while (lines[0]?.trim() === '') lines.shift();
        while (lines.at(-1)?.trim() === '') lines.pop();
        templates.set(name, PromptTemplate.parse(name, lines.join('\n')));
      };
      for (const line of (files.get(path) ?? '').split('\n')) {
        const mark = PromptPack.MARK.exec(line.trim());
        if (mark) {
          flush();
          name = mark[1] ?? null;
          lines = [];
        } else lines.push(line);
      }
      flush();
    }
    return new PromptPack(source, templates);
  }

  /** 러너의 skills/<cairn-runner>/references/*.md */
  static read(skillsDir: string): PromptPack {
    const dir = join(skillsDir, PromptPack.SKILL, 'references');
    const files = new Map<string, string>();
    if (existsSync(dir))
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')))
        files.set(`references/${file}`, readFileSync(join(dir, file), 'utf8'));
    return PromptPack.parse('러너의 skills/', files);
  }

  /**
   * 이번 일의 틀: 서버가 보낸 판이 먼저, 그 판에 없는 틀은 러너의 판에서. 보낸 판이 없거나 읽지 못하면 러너의 판만.
   * 어느 판인지(와 보낸 판을 읽지 못한 까닭)는 로그에 남긴다
   */
  static choose(shipped: SkillPackage | null, skillsDir: string, log: RunLog): PromptPack {
    const pack = PromptPack.pick(shipped, PromptPack.read(skillsDir), log);
    log.info(`지시문 틀: ${pack.source}`);
    return pack;
  }

  private static pick(shipped: SkillPackage | null, local: PromptPack, log: RunLog): PromptPack {
    if (shipped === null || shipped.name !== PromptPack.SKILL) return local;
    try {
      const pack = PromptPack.parse(shipped.label, shipped.files);
      return new PromptPack(pack.source, pack.templates, local);
    } catch (error) {
      log.info(`서버가 보낸 지시문 틀을 읽지 못해 러너의 판을 써요: ${(error as Error).message}`);
      return local;
    }
  }

  /** 틀 하나를 채운 글. 어느 판에도 없으면 PromptProblem (러너의 skills/가 없는 것) */
  fill(name: string, values: PromptValues = {}): string {
    const template = this.templates.get(name) ?? this.fallback?.templates.get(name);
    if (!template) throw new PromptProblem(`지시문 틀이 없어요: ${PromptPack.SKILL}의 ${name}`);
    return template.fill(values);
  }
}
