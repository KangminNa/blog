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

// 다른 프로그램(claude) 실행. 테스트에서는 하위 클래스로 바꾼다.
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

  /** 사람과 주고받는 실행 (브라우저 로그인 등): 입출력을 그대로 넘기고 끝난 코드를 돌려준다 */
  interact(command: string, args: readonly string[]): Promise<number> {
    return new Promise((done) => {
      const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
      child.on('error', () => done(127));
      child.on('close', (code) => done(code ?? 1));
    });
  }
}
