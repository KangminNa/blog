import { RuleViolation } from '../../platform';
import type { SkillFiles } from './skill-files';

// AI에게 가는 지시문의 틀 (러너 스킬 cairn-runner, 2차 1-0 · 기획서 결정 2026-11-14). 글은 코드에 두지 않는다.
// 러너가 대부분을 채우고(apps/runner의 PromptPack, 같은 문법), 서버도 자기가 만드는 지시(목표 실행의 회차 지시,
// read_url의 알림)를 여기서 채운다. 주인이 스킬 메뉴에서 쌓은 판이 저장소 판 위에 얹힌다 (없는 틀은 저장소 판에서).
//
// 문법 (references/*.md): `<!-- 이름 -->` 줄부터 다음 표시 전까지가 틀 하나. {{자리}}는 값,
// {{#자리}}…{{/자리}}는 값이 있을 때만, {{^자리}}…{{/자리}}는 없을 때만 (없음: 빈 글 · 0 · false · null). 여닫는 표시만 있는 줄은 줄째 빠진다
export class PromptTemplates {
  static readonly SKILL = 'cairn-runner';
  private static readonly MARK = /^<!-- ([a-z][a-z0-9-]*) -->$/;
  private static readonly TAG = /\{\{([#^/]?)([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
  private static readonly STANDALONE = /^[ \t]*(\{\{[#^/][a-zA-Z][a-zA-Z0-9]*\}\})[ \t]*\n/gm;

  private constructor(
    /** 틀 이름 → 여닫는 표시만 앞줄에 붙인 본문 */
    private readonly bodies: ReadonlyMap<string, string>,
    private readonly fallback: PromptTemplates | null = null,
  ) {}

  /** 스킬 파일들의 references/*.md에서 틀을 읽는다. 문법이 틀리면 RuleViolation */
  static of(files: SkillFiles): PromptTemplates {
    const bodies = new Map<string, string>();
    const record = files.toRecord();
    const paths = Object.keys(record)
      .filter((p) => p.startsWith('references/'))
      .sort();
    for (const path of paths) {
      let name: string | null = null;
      let lines: string[] = [];
      const flush = () => {
        if (name === null) return;
        if (bodies.has(name)) throw new RuleViolation(`같은 이름의 틀이 둘이에요: ${name}`);
        while (lines[0]?.trim() === '') lines.shift();
        while (lines.at(-1)?.trim() === '') lines.pop();
        const body = `${lines.join('\n')}\n`.replace(PromptTemplates.STANDALONE, '$1');
        PromptTemplates.keysOf(name, body);
        bodies.set(name, body);
      };
      for (const line of (record[path] ?? '').split('\n')) {
        const mark = PromptTemplates.MARK.exec(line.trim());
        if (mark) {
          flush();
          name = mark[1] ?? null;
          lines = [];
        } else lines.push(line);
      }
      flush();
    }
    return new PromptTemplates(bodies);
  }

  /** 지금 쓸 틀: 콘솔 판(있으면)에 없는 틀은 저장소 판에서 */
  static layered(active: SkillFiles | null, repo: SkillFiles): PromptTemplates {
    const base = PromptTemplates.of(repo);
    if (active === null) return base;
    return new PromptTemplates(PromptTemplates.of(active).bodies, base);
  }

  /**
   * 주인이 쌓으려는 판이 저장소 판과 맞는가: 틀 이름이 같고, 틀마다 저장소 판에 있는 자리만 쓴다.
   * 러너와 서버는 이름으로 틀을 찾고 아는 자리만 채운다
   */
  static assertFits(files: SkillFiles, repo: SkillFiles): void {
    const mine = PromptTemplates.of(files);
    const base = PromptTemplates.of(repo);
    for (const name of base.bodies.keys())
      if (!mine.bodies.has(name)) throw new RuleViolation(`틀이 빠졌어요: ${name}`);
    for (const [name, body] of mine.bodies) {
      const known = base.bodies.get(name);
      if (known === undefined) throw new RuleViolation(`저장소 버전에 없는 틀이에요: ${name}`);
      const allowed = PromptTemplates.keysOf(name, known);
      for (const key of PromptTemplates.keysOf(name, body))
        if (!allowed.has(key)) throw new RuleViolation(`${name} 틀에 없는 자리예요: {{${key}}}`);
    }
  }

  /** 틀 하나를 채운 글 (마지막 줄바꿈은 뺀다). 어느 판에도 없으면 RuleViolation (저장소 판이 빠진 것) */
  fill(name: string, values: Readonly<Record<string, string | number | null>> = {}): string {
    const body = this.bodies.get(name) ?? this.fallback?.bodies.get(name);
    if (body === undefined) throw new RuleViolation(`지시문 틀이 없어요: ${name}`);
    let out = '';
    let last = 0;
    const shown: boolean[] = [];
    for (const match of body.matchAll(PromptTemplates.TAG)) {
      const [whole, mark = '', key = ''] = match;
      const on = shown.every(Boolean);
      if (on) out += body.slice(last, match.index);
      if (mark === '') {
        if (on) out += String(values[key] ?? '');
      } else if (mark === '/') shown.pop();
      else {
        const value = values[key];
        const present = value !== null && value !== undefined && value !== '' && value !== 0;
        shown.push(on && present === (mark === '#'));
      }
      last = match.index + whole.length;
    }
    if (shown.every(Boolean)) out += body.slice(last);
    return out.endsWith('\n') ? out.slice(0, -1) : out;
  }

  /** 틀이 쓰는 자리 이름들. 여닫는 표시의 짝이 맞지 않으면 RuleViolation */
  private static keysOf(name: string, body: string): ReadonlySet<string> {
    const keys = new Set<string>();
    const open: string[] = [];
    for (const [, mark = '', key = ''] of body.matchAll(PromptTemplates.TAG)) {
      keys.add(key);
      if (mark === '#' || mark === '^') open.push(key);
      if (mark === '/' && open.pop() !== key)
        throw new RuleViolation(`${name} 틀의 {{/${key}}}에 여는 표시가 없어요`);
    }
    if (open.length > 0)
      throw new RuleViolation(`${name} 틀의 {{#${open.at(-1)}}}가 닫히지 않았어요`);
    return keys;
  }
}
