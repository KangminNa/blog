import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { pause } from './backoff';

/** agent로 돌린 명령 하나의 끝 */
export class StepOutput {
  constructor(
    readonly code: number | null,
    readonly signal: string | null,
    /** 시간이 다 돼 껐다 */
    readonly timedOut: boolean,
    /** 부른 쪽이 그만두게 했다 (취소 · 멈춤) */
    readonly aborted: boolean,
    /** 출력의 끝부분 (stdout을 따로 받으면 stderr만) */
    readonly tail: string,
    /** 표준 출력 전체 (stdoutMax를 준 때만). 한도를 넘으면 null */
    readonly stdout: Buffer | null,
    /** 실행 자체를 못 했다 (파일이 없음, 사용자를 바꾸지 못함) */
    readonly spawnError: string | null,
  ) {}

  get ok(): boolean {
    return this.code === 0 && !this.timedOut && !this.aborted && this.spawnError === null;
  }

  /** 결과 글에 쓰는 끝난 모습 */
  get how(): string {
    if (this.spawnError !== null) return `실행하지 못함 (${this.spawnError})`;
    if (this.timedOut) return '시간 초과';
    if (this.aborted) return '그만둠';
    if (this.signal !== null) return `신호 ${this.signal}`;
    return this.code === 0 ? '통과' : `코드 ${this.code}`;
  }
}

// 코드 러너 칸에서 AI · setup · checks를 돌리는 사용자 (docs/코드작업.md 3단계).
// 러너는 root(권한 CHOWN · SETUID · SETGID · KILL만)이고 AI는 agent(1001)다: 셸을 가진 AI가 러너의 메모리 · 환경 ·
// 연결 값을 읽어 스스로 칸 기기가 되거나 저장소 토큰을 가져가지 못하게.
// agent의 자리에 있는 것은 러너가 실행하지 않고, 읽을 것도 agent 권한으로 읽는다: AI가 심은 링크로 root의 파일을 꺼내지 못하게.
// "self"는 시험용이다 (통합 테스트 · CI에는 agent 사용자가 없다). 같은 사용자라 위의 벽이 없다.
export class AgentUser {
  static readonly SELF = 'self';
  private static readonly ID = /^(\d{1,9}):(\d{1,9})$/;
  private static readonly TAIL_MAX = 4_000;
  private static readonly KILL_ROUNDS = 5;
  private static readonly SHORT_MS = 30_000;
  /** 셸 없이 부르는 도구들의 PATH */
  private static readonly PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

  private constructor(
    /** null이면 self */
    readonly uid: number | null,
    readonly gid: number | null,
  ) {}

  /** "1001:1001" 또는 "self". 모양이 틀리면 null */
  static parse(value: string): AgentUser | null {
    const text = value.trim();
    if (text === AgentUser.SELF) return new AgentUser(null, null);
    const match = AgentUser.ID.exec(text);
    if (!match) return null;
    return new AgentUser(Number(match[1]), Number(match[2]));
  }

  get isSelf(): boolean {
    return this.uid === null;
  }

  get label(): string {
    return this.isSelf ? AgentUser.SELF : `${this.uid}:${this.gid}`;
  }

  /** child_process.spawn에 더할 값. self면 비어 있다 */
  spawnOptions(): { uid?: number; gid?: number } {
    return this.uid === null || this.gid === null ? {} : { uid: this.uid, gid: this.gid };
  }

  /** 셸 명령 하나를 agent로 돌린다 (setup · checks). 자기 프로세스 그룹에서 돌고 끝나면 그룹을 모두 끈다 */
  run(
    command: string,
    options: {
      cwd: string;
      env: Readonly<Record<string, string>>;
      timeoutMs: number;
      signal?: AbortSignal;
      stdoutMax?: number;
    },
  ): Promise<StepOutput> {
    return this.exec('/bin/sh', ['-c', command], options);
  }

  /** 실행 파일 하나를 agent로 돌린다. stdoutMax를 주면 표준 출력을 그만큼까지 모은다 */
  exec(
    bin: string,
    args: readonly string[],
    options: {
      cwd: string;
      env: Readonly<Record<string, string>>;
      timeoutMs: number;
      signal?: AbortSignal;
      stdoutMax?: number;
    },
  ): Promise<StepOutput> {
    const { cwd, env, timeoutMs, signal, stdoutMax } = options;
    return new Promise((resolve) => {
      let tail = '';
      const kept: Buffer[] = [];
      let size = 0;
      let overflow = false;
      let timedOut = false;
      let aborted = false;
      let ended = false;
      const child = spawn(bin, args, {
        cwd,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...this.spawnOptions(),
      });
      const group = (name: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, name);
        } catch {
          // 그룹이 이미 없다
        }
      };
      const note = (chunk: Buffer) => {
        tail = (tail + chunk.toString('utf8')).slice(-AgentUser.TAIL_MAX);
      };
      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutMax === undefined) return note(chunk);
        size += chunk.length;
        if (size > stdoutMax) overflow = true;
        else kept.push(chunk);
      });
      child.stderr.on('data', note);
      const timer = setTimeout(() => {
        timedOut = true;
        group('SIGKILL');
      }, timeoutMs);
      const onAbort = () => {
        aborted = true;
        group('SIGKILL');
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
      const finish = (code: number | null, sig: string | null, spawnError: string | null) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        group('SIGKILL'); // 끝난 명령이 남긴 손자까지
        const stdout = stdoutMax === undefined || overflow ? null : Buffer.concat(kept);
        resolve(new StepOutput(code, sig, timedOut, aborted, tail.trim(), stdout, spawnError));
      };
      child.once('error', (error) => finish(null, null, error.message));
      // 끝나면 그룹을 끈다: 백그라운드로 남은 손자가 출력을 쥐고 있으면 close가 오지 않는다
      child.once('exit', () => group('SIGKILL'));
      child.once('close', (code, sig) => finish(code, sig, null));
    });
  }

  /**
   * agent의 프로세스를 하나도 남기지 않는다 (AI가 띄워 둔 서버 · 손자). 저장소 토큰을 쓰기 전과 자리를 지우기 전에 부른다.
   * self(시험)에서는 하지 않는다: 같은 사용자의 프로세스를 모두 끄면 러너도 꺼진다. 단계마다 그룹을 끈 것으로 갈음한다
   */
  async killAll(): Promise<void> {
    if (this.isSelf) return;
    for (let round = 0; round < AgentUser.KILL_ROUNDS; round++) {
      if ((await this.living()).length === 0) return;
      // agent의 셸이 kill(-1)을 부른다: 그 사용자가 신호를 보낼 수 있는 모든 프로세스 (자기 자신과 1번은 빼고)
      await this.run('kill -9 -1', {
        cwd: '/',
        env: { PATH: AgentUser.PATH },
        timeoutMs: AgentUser.SHORT_MS,
      });
      await pause(100);
    }
    const left = await this.living();
    if (left.length > 0) throw new Error(`agent 프로세스가 끝나지 않아요 (${left.length}개)`);
  }

  /** agent 권한으로 파일을 읽는다. 없거나 읽지 못하거나 maxBytes를 넘으면 null */
  /**
   * agent 권한으로 파일 하나를 읽어 러너의 파일(to, 600)로 옮긴다 (결과물): AI가 링크를 심어도 root로 남의 파일을 읽지 않게.
   * maxBytes를 넘거나 읽지 못하면 false이고 to를 남기지 않는다
   */
  async copyOut(
    path: string,
    to: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const child = spawn('head', ['-c', String(maxBytes + 1), '--', path], {
      cwd: '/',
      env: { PATH: AgentUser.PATH },
      stdio: ['ignore', 'pipe', 'ignore'],
      ...this.spawnOptions(),
      ...(signal ? { signal } : {}),
    });
    const exited = new Promise<number | null>((resolve) => {
      child.once('error', () => resolve(null));
      child.once('close', (code) => resolve(code));
    });
    try {
      await pipeline(child.stdout, createWriteStream(to, { flags: 'wx', mode: 0o600 }));
      if ((await exited) === 0 && (await stat(to)).size <= maxBytes) return true;
    } catch {
      child.kill('SIGKILL');
    }
    await rm(to, { force: true });
    return false;
  }

  async readFile(path: string, maxBytes: number): Promise<string | null> {
    if (this.isSelf) {
      const text = await readFile(path).catch(() => null);
      return text === null || text.length > maxBytes ? null : text.toString('utf8');
    }
    const out = await this.exec('head', ['-c', String(maxBytes + 1), '--', path], {
      cwd: '/',
      env: { PATH: AgentUser.PATH },
      timeoutMs: AgentUser.SHORT_MS,
      stdoutMax: maxBytes,
    });
    return out.ok && out.stdout !== null ? out.stdout.toString('utf8') : null;
  }

  /**
   * agent의 자리를 지운다. 안은 agent 권한으로 비우고(그 안의 링크를 root가 따라가지 않게, 막아 둔 권한도 agent가 다시 연다),
   * 빈 폴더는 러너가 지운다: 폴더 이름은 러너가 만든 부모 폴더에 있어 agent가 지울 수 없다
   */
  async remove(path: string): Promise<void> {
    if (this.isSelf) return rm(path, { recursive: true, force: true });
    const out = await this.exec(
      '/bin/sh',
      ['-c', 'chmod -R u+rwX -- "$1" 2>/dev/null; find "$1" -mindepth 1 -delete', 'sh', path],
      { cwd: '/', env: { PATH: AgentUser.PATH }, timeoutMs: AgentUser.SHORT_MS * 4 },
    );
    if (!out.ok && out.spawnError === null && !/No such file/.test(out.tail))
      throw new Error(`agent의 자리를 비우지 못했어요: ${out.how} ${out.tail}`);
    await rm(path, { recursive: true, force: true });
  }

  /** 러너(root)가 만든 것을 agent에게 넘긴다. 링크는 링크 자신만 (-h): 가리키는 파일의 주인을 바꾸지 않는다 */
  async handTo(path: string): Promise<void> {
    if (this.isSelf) return;
    await new Promise<void>((resolve, reject) => {
      execFile(
        'chown',
        ['-R', '-h', `${this.uid}:${this.gid}`, '--', path],
        { env: { PATH: AgentUser.PATH }, timeout: AgentUser.SHORT_MS * 4 },
        (error, _stdout, stderr) =>
          error
            ? reject(new Error(`agent에게 넘기지 못했어요: ${stderr || error.message}`))
            : resolve(),
      );
    });
  }

  /** 아직 살아 있는 agent의 프로세스 번호들 (/proc의 실제 uid로) */
  private async living(): Promise<readonly number[]> {
    const pids = (await readdir('/proc').catch(() => [] as string[])).filter((n) =>
      /^\d+$/.test(n),
    );
    const found: number[] = [];
    for (const pid of pids) {
      const status = await readFile(`/proc/${pid}/status`, 'utf8').catch(() => '');
      const uid = /^Uid:\s+(\d+)/m.exec(status)?.[1];
      // 이미 끝나 거두기만 기다리는 것(좀비)은 아무것도 못 한다. 거두는 것은 1번 프로세스(compose의 init)의 일이다
      const zombie = /^State:\s+Z/m.test(status);
      if (uid !== undefined && Number(uid) === this.uid && !zombie) found.push(Number(pid));
    }
    return found;
  }
}
