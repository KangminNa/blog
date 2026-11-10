import { execFile } from 'node:child_process';
import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentUser } from './agent-user';

// 코드 작업 하나의 자리 <CAIRN_WORK_DIR>/<작업 id> (docs/코드작업.md 3단계).
//   clean/        러너만 (root 700): 깨끗한 clone. 여기서만 commit · push한다 (GitRepo)
//   git-home/     러너만: 러너의 git이 쓰는 빈 홈
//   change.patch  러너만: agent가 만든 변경을 받아 둔 파일
//   repo/         agent: clean의 사본. AI · setup · checks가 여기서 돈다 (AI CLI의 작업 폴더)
//   home/ · tmp/  agent: AI와 명령들의 홈과 임시 폴더 (공용 /tmp를 쓰지 않는다)
//   ai/           agent: AI CLI의 설정 폴더와 mcp.json (JobWorkspace가 채운다)
// 자리는 작업마다 새로 만들고 끝나면 지운다. agent의 프로세스를 모두 끈 뒤 agent의 것은 agent 권한으로 비운다.
export class CodeRoom {
  private static readonly TASK_ID = /^[0-9a-f-]{36}$/;
  /** agent의 명령에 넘기는 것. 나머지(기기 토큰 등)는 넘기지 않는다 */
  private static readonly PASSED_ENV = [
    'PATH',
    'TZ',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'https_proxy',
    'http_proxy',
    'no_proxy',
  ];

  private constructor(
    readonly dir: string,
    readonly agent: AgentUser,
  ) {}

  /** 새 자리. 같은 작업의 자리가 남아 있으면(지난 실행이 죽음) 지우고 새로 만든다 */
  static async open(base: string, taskId: string, agent: AgentUser): Promise<CodeRoom> {
    if (!CodeRoom.TASK_ID.test(taskId)) throw new Error(`작업 id가 틀려요: ${taskId}`);
    await mkdir(base, { recursive: true });
    const room = new CodeRoom(join(base, taskId), agent);
    await room.close();
    await mkdir(room.dir, { mode: 0o755 });
    await chmod(room.dir, 0o755);
    for (const own of [room.cleanParent, room.gitHome]) await mkdir(own, { mode: 0o700 });
    return room;
  }

  /** 러너만 여는 폴더. clone은 이 안의 clean/에 만든다 (git clone이 폴더를 만든다) */
  private get cleanParent(): string {
    return join(this.dir, 'runner');
  }

  get cleanDir(): string {
    return join(this.cleanParent, 'clean');
  }

  get gitHome(): string {
    return join(this.dir, 'git-home');
  }

  get patchFile(): string {
    return join(this.cleanParent, 'change.patch');
  }

  get repoDir(): string {
    return join(this.dir, 'repo');
  }

  get homeDir(): string {
    return join(this.dir, 'home');
  }

  get tmpDir(): string {
    return join(this.dir, 'tmp');
  }

  get aiDir(): string {
    return join(this.dir, 'ai');
  }

  /** 깨끗한 clone을 사본으로 떠서 agent에게 넘긴다. 링크는 링크로 (따라가지 않는다). 원격 주소에는 자격이 없다 */
  async handOver(): Promise<void> {
    await CodeRoom.copy(this.cleanDir, this.repoDir);
    for (const dir of [this.homeDir, this.tmpDir]) await mkdir(dir, { mode: 0o700 });
    for (const dir of [this.repoDir, this.homeDir, this.tmpDir]) await this.agent.handTo(dir);
  }

  /** agent의 명령(setup · checks · patch 만들기)의 환경: 이 자리의 홈과 임시 폴더, 프록시. 러너의 비밀은 없다 */
  env(): Record<string, string> {
    const passed = CodeRoom.PASSED_ENV.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value] as const];
    });
    return {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      ...Object.fromEntries(passed),
      LANG: 'C.UTF-8',
      HOME: this.homeDir,
      TMPDIR: this.tmpDir,
      CI: '1',
      GIT_TERMINAL_PROMPT: '0',
    };
  }

  /** agent의 프로세스를 모두 끄고 자리를 지운다. 없으면 그냥 넘어간다 */
  async close(): Promise<void> {
    await this.agent.killAll();
    for (const dir of [this.repoDir, this.homeDir, this.tmpDir, this.aiDir])
      await this.agent.remove(dir).catch(() => rm(dir, { recursive: true, force: true }));
    await rm(this.dir, { recursive: true, force: true });
  }

  /** 러너가 시작할 때: 지난 실행이 남긴 자리와 agent 프로세스를 치운다. 치운 자리 수 */
  static async sweep(base: string, agent: AgentUser): Promise<number> {
    const names = await readdir(base).catch(() => [] as string[]);
    const rooms = names.filter((name) => CodeRoom.TASK_ID.test(name));
    await agent.killAll();
    for (const name of rooms) await new CodeRoom(join(base, name), agent).close();
    return rooms.length;
  }

  /** cp -a: 권한 · 링크를 그대로 (링크를 따라가지 않는다) */
  private static copy(from: string, to: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('cp', ['-a', '--', from, to], { timeout: 5 * 60_000 }, (error, _out, stderr) =>
        error
          ? reject(new Error(`저장소 사본을 뜨지 못했어요: ${stderr || error.message}`))
          : resolve(),
      );
    });
  }
}
