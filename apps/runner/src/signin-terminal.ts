import { spawn } from 'node:child_process';
import { ChildExit } from './ai-process';

// 로그인 명령 하나를 가짜 터미널(PTY) 안에서 돌린다. 로그인 화면(Ink)은 터미널이 아니면 뜨지 않는다.
// PTY는 util-linux의 script로 만든다: 러너 이미지에 python3도 node-pty(네이티브 빌드)도 없고, script는 기본으로 들어 있다.
//   리눅스: script -q -e -c "<명령>" /dev/null   (-e: 명령의 종료 코드를 그대로)
//   macOS:  script -q /dev/null /bin/sh -c "<명령>"
// 명령 줄에는 사람이나 서버가 준 값을 넣지 않는다: 실행 파일은 환경 변수로 넘기고, 인자는 이 코드의 고정된 낱말뿐이다.
// 화면 폭을 넓혀(stty) 긴 로그인 주소가 줄바꿈으로 잘리지 않게 한다.
export class SigninTerminal {
  private static readonly COLUMNS = 1000;
  private static readonly ROWS = 50;
  private static readonly BIN_ENV = 'CAIRN_SIGNIN_BIN';
  private static readonly WORD = /^(?:--)?[a-z][a-z-]*$/;
  private static readonly KILL_GRACE_MS = 3_000;

  /** 끝나면 풀린다 */
  readonly exited: Promise<ChildExit>;
  private readonly pid: number | undefined;
  private readonly input: NodeJS.WritableStream;

  /**
   * limitSeconds: 이 시간이 지나면 러너와 상관없이 끝난다 (리눅스, coreutils의 timeout).
   * 러너가 SIGKILL로 죽으면 따로 떠 있는(detached) 명령을 끌 사람이 없어서다. 평소에는 러너가 먼저 끈다
   */
  constructor(
    bin: string,
    args: readonly string[],
    env: Readonly<Record<string, string>>,
    onOutput: (text: string) => void,
    limitSeconds: number,
  ) {
    if (!args.every((arg) => SigninTerminal.WORD.test(arg)))
      throw new Error('로그인 명령의 인자는 고정된 낱말이어야 해요');
    const command = [
      `stty cols ${SigninTerminal.COLUMNS} rows ${SigninTerminal.ROWS} 2>/dev/null`,
      `exec "$${SigninTerminal.BIN_ENV}" ${args.join(' ')}`,
    ].join('; ');
    const [program, ...programArgs] = SigninTerminal.commandLine(command, limitSeconds);
    const child = spawn(program as string, programArgs, {
      env: { ...env, [SigninTerminal.BIN_ENV]: bin, SHELL: '/bin/sh' },
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.pid = child.pid;
    this.input = child.stdin;
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8').on('data', onOutput);
    child.stderr.setEncoding('utf8').on('data', onOutput);
    this.exited = new Promise((resolve) => {
      child.once('error', (error) => resolve(new ChildExit(null, null, error.message)));
      child.once('close', (code, signal) => resolve(new ChildExit(code, signal, null)));
    });
  }

  /** script로 PTY를 만들 수 있는 운영체제인가 */
  static get supported(): boolean {
    return process.platform === 'linux' || process.platform === 'darwin';
  }

  /** 사람이 친 것처럼 넣는다 */
  write(text: string): void {
    this.input.write(text);
  }

  /** 그룹 전체를 끈다. script가 끝나면 PTY가 닫혀 로그인 명령도 끊긴다(SIGHUP) */
  async kill(): Promise<void> {
    this.signal('SIGTERM');
    const timer = setTimeout(() => this.signal('SIGKILL'), SigninTerminal.KILL_GRACE_MS);
    await this.exited;
    clearTimeout(timer);
  }

  private static commandLine(command: string, limitSeconds: number): string[] {
    if (process.platform === 'darwin')
      return ['script', '-q', '/dev/null', '/bin/sh', '-c', command];
    const limit = String(Math.max(1, Math.ceil(limitSeconds)));
    return ['timeout', '-k', '5', limit, 'script', '-q', '-e', '-c', command, '/dev/null'];
  }

  private signal(name: NodeJS.Signals): void {
    if (this.pid === undefined) return;
    try {
      process.kill(-this.pid, name);
    } catch {
      // 이미 끝났다
    }
  }
}
