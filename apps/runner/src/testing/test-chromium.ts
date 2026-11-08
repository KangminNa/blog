import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pause } from '../backoff';

// 테스트용 Chromium: 빈 프로필로 headless로 띄우고 CDP 주소를 알려 준다 (브라우저 탭 읽기의 단위 · 통합 테스트).
// 없으면 테스트를 건너뛴다. 경로는 CAIRN_TEST_CHROMIUM으로 바꿀 수 있다.
export class TestChromium {
  static readonly PATH = process.env.CAIRN_TEST_CHROMIUM ?? '/opt/pw-browsers/chromium';
  /** node:test의 skip 값: 있으면 false, 없으면 이유 */
  static readonly skip = existsSync(TestChromium.PATH)
    ? false
    : `Chromium이 없어요: ${TestChromium.PATH}`;

  private constructor(
    private readonly child: ChildProcess,
    private readonly profile: string,
    /** CDP 주소 (예: http://127.0.0.1:41234) */
    readonly endpoint: string,
  ) {}

  /** 자기 프로세스 그룹으로 띄운다: 끌 때 도우미 프로세스(네트워크 · 저장소)까지 함께 끈다 */
  static async start(): Promise<TestChromium> {
    const profile = mkdtempSync(join(tmpdir(), 'cairn-chromium-'));
    const child = spawn(
      TestChromium.PATH,
      [
        '--headless=new',
        '--no-sandbox',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore', detached: true },
    );
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await pause(100);
    if (!existsSync(portFile)) throw new Error('Chromium이 10초 안에 뜨지 않았어요');
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    return new TestChromium(child, profile, `http://127.0.0.1:${port}`);
  }

  /** 읽은 탭이 닫혔는지 보려고: 지금 열린 탭의 주소들 */
  async openUrls(): Promise<string[]> {
    const tabs = (await (await fetch(`${this.endpoint}/json/list`)).json()) as { url: string }[];
    return tabs.map((t) => t.url);
  }

  /** 그룹 전체를 끄고, 다 끝난 뒤 프로필을 지운다 (끝나는 동안에도 프로필에 쓴다) */
  async stop(): Promise<void> {
    const exited = new Promise((done) => this.child.once('exit', done));
    if (this.child.pid) process.kill(-this.child.pid, 'SIGKILL');
    await exited;
    rmSync(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
