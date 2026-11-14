import { spawn } from 'node:child_process';

/** 명령 하나의 결과 */
export class ShellResult {
  constructor(
    readonly code: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {}

  get ok(): boolean {
    return this.code === 0;
  }

  /** 화면에 보여줄 출력 (표준 출력 + 오류 출력) */
  get output(): string {
    return `${this.stdout}${this.stderr}`.trim();
  }
}

// 다른 프로그램(claude, 브라우저) 실행. 테스트에서는 하위 클래스로 바꾼다.
export class Shell {
  /** 출력을 받아 오는 실행 */
  run(command: string, args: readonly string[]): Promise<ShellResult> {
    return new Promise((done) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => done(new ShellResult(127, '', error.message)));
      child.on('close', (code) => done(new ShellResult(code ?? 1, stdout, stderr)));
    });
  }

  /** 기본 브라우저로 주소를 연다. 열지 못해도 실패하지 않는다 (화면에 찍은 주소를 사람이 연다) */
  async openBrowser(url: string): Promise<void> {
    const [command, args]: [string, string[]] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
          : ['xdg-open', [url]];
    await new Promise<void>((done) => {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.on('error', () => done());
      child.on('spawn', () => {
        child.unref();
        done();
      });
    });
  }

  /** 사람과 주고받는 실행 (브라우저 로그인 등): 입출력을 그대로 넘기고 끝난 코드를 돌려준다 */
  interact(command: string, args: readonly string[]): Promise<number> {
    return new Promise((done) => {
      const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
      child.on('error', () => done(127));
      child.on('close', (code) => done(code ?? 1));
    });
  }
}
