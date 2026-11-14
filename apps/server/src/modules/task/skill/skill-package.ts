import { JobSkillView } from '../task/job.view';
import type { SkillRevisionRow } from '../task.tables';
import { SkillFiles } from './skill-files';

// 일 하나에 실어 보내는 스킬 한 판. 콘솔 판이 있으면 그것(사람이 정한 것이 우선), 없으면 저장소 판.
// 러너는 디스크의 skills/ 대신 이것으로 깔아서, 어느 러너든 같은 판으로 돈다.
export class SkillPackage {
  static readonly REPO = 'repo';
  static readonly CONSOLE = 'console';

  private constructor(
    readonly name: string,
    readonly source: string,
    /** 콘솔 판 번호. 저장소 판이면 null */
    readonly revision: number | null,
    readonly files: SkillFiles,
  ) {}

  /** 지금 쓰는 판. 둘 다 없으면 null (러너는 스킬 없이 지시만으로 한다) */
  static pick(
    name: string,
    console: SkillRevisionRow | null,
    repo: SkillFiles | null,
  ): SkillPackage | null {
    if (console)
      return new SkillPackage(
        name,
        SkillPackage.CONSOLE,
        console.revision,
        SkillFiles.trusted(console.files as Record<string, string>),
      );
    return repo ? new SkillPackage(name, SkillPackage.REPO, null, repo) : null;
  }

  get hash(): string {
    return this.files.hash;
  }

  jobView(): JobSkillView {
    return new JobSkillView(
      this.name,
      this.source,
      this.revision,
      this.hash,
      this.files.toRecord(),
    );
  }
}
