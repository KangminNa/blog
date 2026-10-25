import { createInterface } from 'node:readline/promises';

/** 사용자에게 그대로 보여줄 실패. 명령은 이 문구를 찍고 1로 끝난다 */
export class CliError extends Error {}

// 화면에 찍기와 묻기. --yes면 묻지 않고 "예"로 간다. 테스트에서는 하위 클래스로 바꾼다.
export class Terminal {
  constructor(private readonly assumeYes = false) {}

  say(line = ''): void {
    process.stdout.write(`${line}\n`);
  }

  /** 사람이 직접 입력할 수 있는 터미널인가 (브라우저 로그인처럼 주고받는 단계에 필요) */
  get interactive(): boolean {
    return Boolean(process.stdin.isTTY);
  }

  /** 끝난 단계 한 줄 */
  done(text: string): void {
    this.say(`✓ ${text}`);
  }

  /** 예/아니요. 답할 수 없는 곳(파이프 등)에서는 아니요 */
  async confirm(question: string): Promise<boolean> {
    if (this.assumeYes) {
      this.say(`${question} → 예 (--yes)`);
      return true;
    }
    if (!process.stdin.isTTY) return false;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question(`${question} (y/N) `)).trim().toLowerCase();
      return ['y', 'yes', '예', 'ㅇ'].includes(answer);
    } finally {
      rl.close();
    }
  }
}
