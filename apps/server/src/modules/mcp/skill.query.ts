import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, NotFound, ZipFile } from '../platform';

/** 앱에 올릴 스킬 묶음 */
export class SkillPackageView {
  constructor(
    readonly name: string,
    /** 묶음 안의 경로(<이름>/SKILL.md 등) → 내용 */
    readonly files: ReadonlyMap<string, string>,
  ) {}

  get fileName(): string {
    return `${this.name}.zip`;
  }

  zip(): Buffer {
    const zip = new ZipFile();
    for (const [path, text] of this.files) zip.add(path, text);
    return zip.toBuffer();
  }
}

// ChatGPT·Claude 앱(웹·데스크톱 채팅)에 사용자가 직접 올릴 스킬 묶음. DB가 아니라 저장소의 skills/<이름>/에서 읽는다.
// 앱에서는 이 컴퓨터의 스크립트를 쓸 수 없어서 scripts/와 agents/는 빼고, {{SKILL_DIR}}은 "이 스킬 폴더"로 바꾼다.
// 이 컴퓨터에서 도는 도구(Claude Code·Codex)는 이것이 아니라 cairn connect가 함께 든 스킬을 넣는다.
@Injectable()
export class SkillQuery extends BaseQuery {
  private static readonly NAME = /^[a-z0-9-]{1,40}$/;
  private static readonly SKIP = new Set(['scripts', 'agents']);

  /** 주인만 (관리 화면 기기 시트의 "스킬 받기") */
  appPackage(actor: Actor, name: string): SkillPackageView {
    actor.assertCan(Actor.WRITE);
    const dir = join(SkillQuery.root(), name);
    if (!SkillQuery.NAME.test(name) || !existsSync(join(dir, 'SKILL.md')))
      throw new NotFound(`없는 스킬이에요: ${name}`);
    const files = new Map<string, string>();
    const walk = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : 1,
      )) {
        if (entry.name.startsWith('.')) continue;
        const path = join(at, entry.name);
        if (entry.isDirectory()) {
          if (!(at === dir && SkillQuery.SKIP.has(entry.name))) walk(path);
        } else if (entry.name.endsWith('.md')) {
          const rel = relative(dir, path).split('\\').join('/');
          const text = readFileSync(path, 'utf8').split('{{SKILL_DIR}}').join('이 스킬 폴더');
          files.set(`${name}/${rel}`, text);
        }
      }
    };
    walk(dir);
    return new SkillPackageView(name, files);
  }

  /** 저장소의 skills 폴더 (CAIRN_SKILLS_DIR로 바꿀 수 있다). 서버는 apps/server에서 돈다 */
  private static root(): string {
    return process.env.CAIRN_SKILLS_DIR ?? resolve(process.cwd(), '../../skills');
  }
}
