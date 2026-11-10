import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BaseGateway } from '../../platform';
import { SkillFiles } from './skill-files';

// 저장소 skills/의 러너 전용 스킬 (SKILL.md 앞부분에 cairn-where: runner). 서버 이미지에 함께 든 판이라
// 프로세스가 도는 동안 바뀌지 않는다: 처음 한 번 읽어 둔다. 러너가 깔 수 있는 SKILL.md와 references/*.md만 읽는다.
// 폴더는 CAIRN_SKILLS_DIR로 바꿀 수 있다 (앱용 zip의 SkillQuery와 같은 곳).
export class RepoSkillGateway extends BaseGateway {
  protected readonly name = '저장소 스킬';
  private static readonly NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
  private cache: ReadonlyMap<string, SkillFiles> | null = null;

  constructor(private readonly dir: string) {
    super();
  }

  static fromEnv(): RepoSkillGateway {
    return new RepoSkillGateway(
      process.env.CAIRN_SKILLS_DIR ?? resolve(process.cwd(), '../../skills'),
    );
  }

  /** 러너 전용 스킬들 (이름 순) */
  all(): ReadonlyMap<string, SkillFiles> {
    this.cache ??= this.read();
    return this.cache;
  }

  /** 러너 전용 스킬 하나. 없으면 null */
  get(name: string): SkillFiles | null {
    return this.all().get(name) ?? null;
  }

  private read(): ReadonlyMap<string, SkillFiles> {
    const found = new Map<string, SkillFiles>();
    const names = existsSync(this.dir) ? readdirSync(this.dir).sort() : [];
    for (const name of names.filter((n) => RepoSkillGateway.NAME.test(n))) {
      const entry = join(this.dir, name, SkillFiles.ENTRY);
      if (!existsSync(entry)) continue;
      const skillMd = readFileSync(entry, 'utf8');
      if (!SkillFiles.isRunnerSkill(skillMd)) continue;
      const files: Record<string, string> = { [SkillFiles.ENTRY]: skillMd };
      const references = join(this.dir, name, 'references');
      if (existsSync(references))
        for (const file of readdirSync(references)
          .filter((f) => f.endsWith('.md'))
          .sort())
          files[`references/${file}`] = readFileSync(join(references, file), 'utf8');
      found.set(name, SkillFiles.trusted(files));
    }
    return found;
  }
}
