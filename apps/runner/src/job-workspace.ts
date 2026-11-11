import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { AgentUser } from './agent-user';
import type { SkillPackage } from './job';
import type { SandboxRoom } from './sandbox-room';

// 일 하나의 자리. 사용자의 연결(connector), MCP 서버, 설정, 스킬을 물려받지 않게 작업마다 새로 만들고 지운다.
//   work/      AI CLI가 도는 빈 폴더
//   config/    별도 설정 폴더 (CLAUDE_CONFIG_DIR). 권한 설정과, 스킬이 있으면 스킬을 넣는다
//   home/      빈 홈
//   work/outputs/ AI가 사람에게 줄 파일을 두는 곳. 일이 잘 끝나면 러너가 결과물로 올린다 (OutputBatch)
//   mcp.json   작업 토큰이 든 MCP 설정 (600). work 밖에 두어 AI가 파일로 읽지 못하게 한다. 연결 확인에는 없다
// 코드 러너 칸의 일(코드 · 만들기)은 칸의 자리(SandboxRoom) 안에 둔다: work는 그 자리의 work/(코드 작업은 저장소 사본),
// 홈은 home/, 설정은 ai/, 만들기 작업의 재료는 inputs/.
// 러너(root)가 써 둔 뒤 agent에게 넘긴다 (handOver). 셸이 있으니 mcp.json의 작업 토큰은 AI가 읽을 수 있다: 그 에이전트의 것이다.
export class JobWorkspace {
  private static readonly SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;
  /** 스킬의 하위 에이전트는 러너가 도구를 주지 않아 쓰지 못한다 */
  private static readonly SKILL_SKIPPED = ['agents'];

  private constructor(
    private readonly root: string,
    /** mcp.json을 두었는가 */
    readonly mcpReady: boolean,
    /** job.skill을 config/skills에 넣었는가 */
    readonly skillReady: boolean,
    /** 코드 러너 칸의 자리. 있으면 AI는 그 자리의 agent로 돈다 */
    private readonly room: SandboxRoom | null = null,
  ) {}

  /**
   * mcpConfig: mcp.json에 쓸 글, 없으면 MCP 없이. settings: config/settings.json에 쓸 글, 없으면 쓰지 않는다 (Claude만 쓴다).
   * skill이 없거나 폴더에 없으면 스킬 없이 만든다. 도구마다 다른 설정은 도구가 config/에 더 쓴다 (CodexCli)
   */
  static async open(
    mcpConfig: string | null,
    settings: string | null,
    skill: string | null,
    skillsDir: string,
    room: SandboxRoom | null = null,
    /** 서버가 실어 보낸 스킬. 있으면 디스크의 skills/ 대신 이것을 깐다 */
    skillPackage: SkillPackage | null = null,
  ): Promise<JobWorkspace> {
    const root = room ? room.aiDir : await mkdtemp(join(await realpath(tmpdir()), 'cairn-run-'));
    if (room) await mkdir(root, { mode: 0o700 });
    await chmod(root, 0o700);
    for (const dir of room ? ['config'] : ['work', 'config', 'home', join('work', 'outputs')])
      await mkdir(join(root, dir));
    if (mcpConfig !== null) {
      await writeFile(join(root, 'mcp.json'), mcpConfig, { mode: 0o600, flag: 'wx' });
      await chmod(join(root, 'mcp.json'), 0o600);
    }
    if (settings !== null)
      await writeFile(join(root, 'config', 'settings.json'), settings, { flag: 'wx' });
    const skillReady = skillPackage
      ? JobWorkspace.installPackage(skillPackage, root)
      : skill !== null && JobWorkspace.install(skill, skillsDir, root);
    return new JobWorkspace(root, mcpConfig !== null, skillReady, room);
  }

  /** 도구가 설정을 다 쓴 뒤: 코드 러너 칸이면 설정 폴더를 agent에게 넘긴다 (AI CLI가 agent로 읽고 쓴다) */
  async handOver(): Promise<void> {
    if (this.room) await this.room.agent.handTo(this.root);
  }

  /** AI CLI를 돌릴 사용자. 코드 러너 칸이 아니면 러너와 같은 사용자 (null) */
  get user(): AgentUser | null {
    return this.room?.agent ?? null;
  }

  get workDir(): string {
    return this.room ? this.room.workDir : join(this.root, 'work');
  }

  /** AI가 결과물을 두는 폴더. 코드 러너 칸이면 저장소 밖의 자리 폴더 */
  get outputsDir(): string {
    return this.room ? this.room.outputsDir : join(this.root, 'work', 'outputs');
  }

  /** 만들기 작업의 재료 파일 폴더. 받은 재료가 없으면 null */
  get inputsDir(): string | null {
    return this.room && existsSync(this.room.inputsDir) ? this.room.inputsDir : null;
  }

  /** 결과물을 올리기 전에 옮겨 둘 러너만의 폴더. 코드 러너 칸이 아니면 null (제자리에서 읽는다) */
  get outputsStage(): string | null {
    return this.room ? this.room.outputsStage : null;
  }

  /** AI의 임시 폴더. 코드 러너 칸이 아니면 null (러너의 것을 쓴다) */
  get tmpDir(): string | null {
    return this.room ? this.room.tmpDir : null;
  }

  get configDir(): string {
    return join(this.root, 'config');
  }

  get homeDir(): string {
    return this.room ? this.room.homeDir : join(this.root, 'home');
  }

  get mcpConfigPath(): string {
    return join(this.root, 'mcp.json');
  }

  /** 코드 러너 칸의 자리는 SandboxRoom이 agent 프로세스를 끈 뒤 지운다 */
  async remove(): Promise<void> {
    if (this.room) return;
    await rm(this.root, { recursive: true, force: true });
  }

  /** 설정 폴더의 파일 (CLI가 갱신한 자격). 코드 러너 칸이면 agent 권한으로 읽는다: AI가 심은 링크를 root가 따라가지 않게 */
  async readConfig(name: string, maxBytes: number): Promise<string | null> {
    const path = join(this.configDir, name);
    if (this.room) return this.room.agent.readFile(path, maxBytes);
    const text = await readFile(path, 'utf8').catch(() => null);
    return text === null || text.length > maxBytes ? null : text;
  }

  /** 스킬의 SKILL.md 글. 이름의 모양이 틀렸거나 없으면 null (스킬 폴더를 읽지 못하는 CLI에게 지시문으로 준다) */
  static skillText(skill: string, skillsDir: string): string | null {
    const file = join(skillsDir, skill, 'SKILL.md');
    if (!JobWorkspace.SKILL_NAME.test(skill) || !existsSync(file)) return null;
    return readFileSync(file, 'utf8');
  }

  /** 서버가 보낸 판을 config/skills/<이름>/에 쓴다. 경로 모양은 SkillPackage.from이 이미 봤다 */
  private static installPackage(skill: SkillPackage, root: string): boolean {
    const to = join(root, 'config', 'skills', skill.name);
    for (const [path, text] of skill.files) {
      const file = join(to, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text.split('{{SKILL_DIR}}').join(to));
    }
    return true;
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
