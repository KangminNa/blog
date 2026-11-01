import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** AI CLI가 끝난 모습 */
export class ChildExit {
  constructor(
    readonly code: number | null,
    readonly signal: string | null,
    /** 실행 자체를 못 함 (파일이 없음 등) */
    readonly spawnError: string | null,
  ) {}
}

// AI CLI 프로세스 하나. 터미널의 Ctrl-C가 곧바로 닿지 않고 손자까지 함께 끝낼 수 있게 자기 프로세스 그룹에서 띄운다.
// 지시는 표준 입력으로 준다: 인자로 주면 '-'로 시작하는 글이 옵션으로 읽힐 수 있고 ps에 보인다.
export class AiProcess {
  private static readonly KILL_GRACE_MS = 3_000;
  /** 끝난 뒤 손자가 출력을 쥐고 있어도 이만큼만 기다린다 */
  private static readonly DRAIN_MS = 2_000;
  private static readonly STDERR_MAX = 2_000;

  /** 끝나고 출력을 다 읽은 뒤 풀린다 */
  readonly exited: Promise<ChildExit>;
  private stderr = '';
  private readonly pid: number | undefined;

  constructor(
    bin: string,
    args: readonly string[],
    cwd: string,
    env: Readonly<Record<string, string>>,
    prompt: string,
    onLine: (line: string) => void,
  ) {
    const child = spawn(bin, args, {
      cwd,
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.pid = child.pid;
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on(
      'line',
      onLine,
    );
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-AiProcess.STDERR_MAX);
    });
    this.exited = new Promise((resolve) => {
      let ended: ChildExit | null = null;
      const finish = () => {
        if (ended === null) return;
        this.signal('SIGKILL');
        resolve(ended);
      };
      child.once('error', (error) => {
        ended ??= new ChildExit(null, null, error.message);
        finish();
      });
      child.once('exit', (code, signal) => {
        ended = new ChildExit(code, signal, null);
        setTimeout(finish, AiProcess.DRAIN_MS).unref();
      });
      child.once('close', finish);
    });
  }

  /** 표준 오류의 끝부분 */
  get stderrTail(): string {
    return this.stderr.trim();
  }

  /** 그룹 전체를 끝낸다. SIGTERM을 주고 듣지 않으면 SIGKILL */
  async kill(): Promise<void> {
    this.signal('SIGTERM');
    const timer = setTimeout(() => this.signal('SIGKILL'), AiProcess.KILL_GRACE_MS);
    await this.exited;
    clearTimeout(timer);
  }

  /** 이미 끝났으면 조용히 넘어간다 */
  private signal(name: NodeJS.Signals): void {
    if (this.pid === undefined) return;
    try {
      process.kill(-this.pid, name);
    } catch {
      // 그룹이 이미 없다
    }
  }
}
