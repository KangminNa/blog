import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentUser } from './agent-user';

// 코드 러너 칸에서 일 하나의 자리 <CAIRN_WORK_DIR>/<작업 id>. 코드 작업(docs/코드작업.md 3단계)과 만들기 작업(결과물 2차)이 함께 쓴다.
//   runner/clean/ 러너만 (root 700): 코드 작업의 깨끗한 clone. 여기서만 commit · push한다 (GitRepo)
//   git-home/     러너만: 러너의 git이 쓰는 빈 홈
//   change.patch  러너만: agent가 만든 변경을 받아 둔 파일
//   work/         agent: AI · setup · checks가 도는 작업 폴더. 코드 작업은 clean의 사본, 만들기 작업은 빈 폴더
//   inputs/       agent: 만들기 작업의 재료 파일 (러너가 begin_download로 받아 넘긴다)
//   home/ · tmp/  agent: AI와 명령들의 홈과 임시 폴더 (공용 /tmp를 쓰지 않는다)
//   ai/           agent: AI CLI의 설정 폴더와 mcp.json (JobWorkspace가 채운다)
//   outputs/      agent: AI가 사람에게 줄 파일을 두는 곳. 저장소 밖이라 patch에 들어가지 않는다
//   runner/outputs/ 러너만: outputs의 파일을 agent 권한으로 읽어 옮겨 둔 사본 (OutputBatch가 올린다)
// 자리는 작업마다 새로 만들고 끝나면 지운다. agent의 프로세스를 모두 끈 뒤 agent의 것은 agent 권한으로 비운다.
export class SandboxRoom {
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
  static async open(base: string, taskId: string, agent: AgentUser): Promise<SandboxRoom> {
    if (!SandboxRoom.TASK_ID.test(taskId)) throw new Error(`작업 id가 틀려요: ${taskId}`);
    // 부모와 자리는 711: agent는 자기 자리(repo · home · tmp · ai)로 들어갈 수만 있고 목록은 보지 못한다
    await mkdir(base, { recursive: true });
    await chmod(base, 0o711);
    const room = new SandboxRoom(join(base, taskId), agent);
    await room.close();
    await mkdir(room.dir, { mode: 0o711 });
    await chmod(room.dir, 0o711);
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

  /** AI CLI의 작업 폴더 (코드 작업은 저장소 사본) */
  get workDir(): string {
    return join(this.dir, 'work');
  }

  /** 만들기 작업의 재료 파일. 러너가 받는 동안은 러너의 것이고, 넘긴 뒤에는 agent의 것 */
  get inputsDir(): string {
    return join(this.dir, 'inputs');
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

  get outputsDir(): string {
    return join(this.dir, 'outputs');
  }

  /** 결과물을 올리기 전에 옮겨 두는 러너만의 폴더 */
  get outputsStage(): string {
    return join(this.cleanParent, 'outputs');
  }

  /**
   * agent에게 자리를 넘긴다. 코드 작업은 깨끗한 clone을 사본으로 떠서(링크는 링크로, 따라가지 않는다. 원격 주소에는 자격이 없다),
   * 만들기 작업(copy: false)은 빈 작업 폴더로. 받아 둔 재료(inputs/)가 있으면 함께 넘긴다
   */
  async handOver(copy = true): Promise<void> {
    if (copy) await SandboxRoom.copy(this.cleanDir, this.workDir);
    else await mkdir(this.workDir, { mode: 0o700 });
    for (const dir of [this.homeDir, this.tmpDir, this.outputsDir])
      await mkdir(dir, { mode: 0o700 });
    const inputs = existsSync(this.inputsDir) ? [this.inputsDir] : [];
    for (const dir of [this.workDir, this.homeDir, this.tmpDir, this.outputsDir, ...inputs])
      await this.agent.handTo(dir);
  }

  /** 재료를 받을 폴더를 연다 (러너만, 700). handOver가 agent에게 넘긴다 */
  async openInputs(): Promise<string> {
    await mkdir(this.inputsDir, { mode: 0o700 });
    return this.inputsDir;
  }

  /** agent의 명령(setup · checks · patch 만들기)의 환경: 이 자리의 홈과 임시 폴더, 프록시. 러너의 비밀은 없다 */
  env(): Record<string, string> {
    const passed = SandboxRoom.PASSED_ENV.flatMap((name) => {
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
    const dirs = [
      this.workDir,
      this.inputsDir,
      this.homeDir,
      this.tmpDir,
      this.aiDir,
      this.outputsDir,
    ];
    for (const dir of dirs)
      await this.agent.remove(dir).catch(() => rm(dir, { recursive: true, force: true }));
    await rm(this.dir, { recursive: true, force: true });
  }

  /** 러너가 시작할 때: 지난 실행이 남긴 자리와 agent 프로세스를 치운다. 치운 자리 수 */
  static async sweep(base: string, agent: AgentUser): Promise<number> {
    const names = await readdir(base).catch(() => [] as string[]);
    const rooms = names.filter((name) => SandboxRoom.TASK_ID.test(name));
    await agent.killAll();
    for (const name of rooms) await new SandboxRoom(join(base, name), agent).close();
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
