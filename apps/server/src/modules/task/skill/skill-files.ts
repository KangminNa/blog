import { createHash } from 'node:crypto';
import { RuleViolation } from '../../platform';

// 러너 스킬 한 판의 파일들 (SKILL.md와 references/*.md). 경로 규칙과 해시를 한 곳에 둔다:
// 주인이 콘솔에서 판을 쌓을 때, 서버가 저장소 판을 읽을 때, 러너에게 실어 보낼 때, 실행을 기록할 때 같은 해시를 쓴다.
// 해시는 경로 순으로 "경로\0내용\0"을 이어 만든 sha256이다 (러너도 같은 방법으로 확인할 수 있다).
export class SkillFiles {
  static readonly ENTRY = 'SKILL.md';
  static readonly FILES_MAX = 10;
  static readonly FILE_MAX = 64 * 1024;
  static readonly TOTAL_MAX = 128 * 1024;
  /** 러너가 깔 수 있는 경로 (스킬 폴더 밖이나 실행 파일은 없다) */
  private static readonly PATH = /^(SKILL\.md|references\/[a-z0-9][a-z0-9._-]{0,60}\.md)$/;
  /** 러너 전용 스킬의 표시 (cairn connect가 사람의 AI 도구에 넣지 않는다) */
  private static readonly RUNNER = /^cairn-where: runner$/m;
  private static readonly FRONT = /^---\n([\s\S]*?)\n---\n/;

  private constructor(private readonly files: ReadonlyMap<string, string>) {}

  /**
   * 주인이 보낸 파일들. 규칙을 어기면 RuleViolation: 경로는 SKILL.md와 references/*.md만, 개수 · 크기 한도,
   * SKILL.md 앞부분의 name이 스킬 이름과 같고 cairn-where: runner가 남아 있어야 한다
   */
  static of(name: string, raw: Readonly<Record<string, string>>): SkillFiles {
    const entries = Object.entries(raw);
    if (entries.length === 0 || entries.length > SkillFiles.FILES_MAX)
      throw new RuleViolation(`파일은 1~${SkillFiles.FILES_MAX}개예요`);
    let total = 0;
    for (const [path, text] of entries) {
      if (!SkillFiles.PATH.test(path))
        throw new RuleViolation(`SKILL.md와 references/<이름>.md만 둘 수 있어요: ${path}`);
      const size = Buffer.byteLength(text);
      if (size > SkillFiles.FILE_MAX)
        throw new RuleViolation(`파일 하나는 ${SkillFiles.FILE_MAX / 1024}KB까지예요: ${path}`);
      if (text.includes('\0')) throw new RuleViolation(`글자가 아닌 것이 들어 있어요: ${path}`);
      total += size;
    }
    if (total > SkillFiles.TOTAL_MAX)
      throw new RuleViolation(`파일을 합쳐 ${SkillFiles.TOTAL_MAX / 1024}KB까지예요`);
    const files = new SkillFiles(new Map(entries));
    files.assertHead(name);
    return files;
  }

  /** 저장소 판이나 이미 쌓인 판: 규칙을 지난 파일들 (다시 보지 않는다) */
  static trusted(raw: Readonly<Record<string, string>>): SkillFiles {
    return new SkillFiles(new Map(Object.entries(raw)));
  }

  /** 러너 전용 스킬인가 (SKILL.md 앞부분의 cairn-where: runner) */
  static isRunnerSkill(skillMd: string): boolean {
    return SkillFiles.RUNNER.test(SkillFiles.FRONT.exec(skillMd)?.[1] ?? '');
  }

  get hash(): string {
    const hash = createHash('sha256');
    for (const [path, text] of [...this.files].sort(([a], [b]) => (a < b ? -1 : 1)))
      hash.update(`${path}\0${text}\0`);
    return hash.digest('hex');
  }

  /** SKILL.md 앞부분의 description (목록에 보인다) */
  get description(): string {
    const head = SkillFiles.FRONT.exec(this.files.get(SkillFiles.ENTRY) ?? '')?.[1] ?? '';
    return /^description: (.*)$/m.exec(head)?.[1]?.trim() ?? '';
  }

  /** 저장 · 응답의 모양 */
  toRecord(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.files);
  }

  private assertHead(name: string): void {
    const head = SkillFiles.FRONT.exec(this.files.get(SkillFiles.ENTRY) ?? '')?.[1];
    if (head === undefined)
      throw new RuleViolation('SKILL.md가 있어야 하고, 맨 앞에 --- 로 감싼 앞부분이 있어야 해요');
    if (/^name: (.*)$/m.exec(head)?.[1]?.trim() !== name)
      throw new RuleViolation(`SKILL.md 앞부분의 name은 ${name}이어야 해요`);
    if (!SkillFiles.RUNNER.test(head))
      throw new RuleViolation('SKILL.md 앞부분에 cairn-where: runner를 남겨 두어야 해요');
  }
}
