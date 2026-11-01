import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

// 일 하나의 자리. 사용자의 연결(connector), MCP 서버, 설정, 스킬을 물려받지 않게 작업마다 새로 만들고 지운다.
//   work/      AI CLI가 도는 빈 폴더
//   config/    별도 설정 폴더 (CLAUDE_CONFIG_DIR). 권한 설정과, 스킬이 있으면 스킬을 넣는다
//   home/      빈 홈
//   mcp.json   작업 토큰이 든 MCP 설정 (600). work 밖에 두어 AI가 파일로 읽지 못하게 한다
export class JobWorkspace {
  private static readonly SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;
  /** 스킬의 하위 에이전트는 러너가 도구를 주지 않아 쓰지 못한다 */
  private static readonly SKILL_SKIPPED = ['agents'];

  private constructor(
    private readonly root: string,
    /** job.skill을 config/skills에 넣었는가 */
    readonly skillReady: boolean,
  ) {}

  /** mcpConfig: mcp.json에 쓸 글. settings: config/settings.json에 쓸 글. skill이 없거나 폴더에 없으면 스킬 없이 만든다 */
  static async open(
    mcpConfig: string,
    settings: string,
    skill: string | null,
    skillsDir: string,
  ): Promise<JobWorkspace> {
    const root = await mkdtemp(join(await realpath(tmpdir()), 'cairn-run-'));
    await chmod(root, 0o700);
    for (const dir of ['work', 'config', 'home']) await mkdir(join(root, dir));
    await writeFile(join(root, 'mcp.json'), mcpConfig, { mode: 0o600, flag: 'wx' });
    await chmod(join(root, 'mcp.json'), 0o600);
    await writeFile(join(root, 'config', 'settings.json'), settings, { flag: 'wx' });
    const skillReady = skill !== null && JobWorkspace.install(skill, skillsDir, root);
    return new JobWorkspace(root, skillReady);
  }

  get workDir(): string {
    return join(this.root, 'work');
  }

  get configDir(): string {
    return join(this.root, 'config');
  }

  get homeDir(): string {
    return join(this.root, 'home');
  }

  get mcpConfigPath(): string {
    return join(this.root, 'mcp.json');
  }

  async remove(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  /** 이름은 서버가 보낸 값이라 경로로 쓰기 전에 모양을 본다. 스킬은 저장소에 든 것만 넣는다 */
  private static install(skill: string, skillsDir: string, root: string): boolean {
    const from = join(skillsDir, skill);
    if (!JobWorkspace.SKILL_NAME.test(skill) || !existsSync(join(from, 'SKILL.md'))) return false;
    const to = join(root, 'config', 'skills', skill);
    cpSync(from, to, {
      recursive: true,
      filter: (path) =>
        !basename(path).startsWith('.') && !JobWorkspace.SKILL_SKIPPED.includes(basename(path)),
    });
    for (const entry of readdirSync(to, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const path = join(entry.parentPath, entry.name);
      writeFileSync(path, readFileSync(path, 'utf8').split('{{SKILL_DIR}}').join(to));
    }
    return true;
  }
}
