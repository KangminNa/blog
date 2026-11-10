import { readFile } from 'node:fs/promises';
import { Backoff } from './backoff';
import type { RunLog } from './redactor';

// 서버 러너의 연결: 서버와 러너만 보는 볼륨의 연결 값을 내밀고 기기 토큰을 받는다 (서버의 POST /api/devices/server-runner).
// 코드 러너 칸도 같은 길로 붙는다: 칸에만 붙는 볼륨의 값과 칸 번호 (POST /api/devices/code-runner).
// 사람이 토큰을 옮기지 않는다. 받은 토큰은 메모리에만 둔다: 러너가 다시 뜨면 다시 받고, 서버는 앞 토큰을 바로 막는다.
// 러너가 서버와 나누는 말은 MCP뿐이고, 이 연결만 그 앞의 한 번이다.
// 설치 전(409), 파일이 아직 없음, 서버가 아직 안 뜸은 기다렸다 다시 묻는다. 멈추라고 하면 null.
export class ServerPairing {
  private static readonly TIMEOUT_MS = 10_000;
  /** 같은 이유는 한 번만 적는다 */
  private lastNote: string | null = null;

  constructor(
    private readonly serverUrl: string,
    private readonly file: string,
    private readonly log: RunLog,
    private readonly backoff = new Backoff(1_000, 30_000),
    /** 코드 러너 칸의 번호. 있으면 칸으로 연결한다 (POST /api/devices/code-runner, 서버 러너와 다른 연결 값) */
    private readonly slot: string | null = null,
  ) {}

  async token(stop: AbortSignal): Promise<string | null> {
    while (!stop.aborted) {
      try {
        const token = await this.ask(await this.secret(), stop);
        this.backoff.reset();
        this.lastNote = null;
        this.log.info(
          this.slot === null ? '서버 러너로 연결했어요' : `코드 러너 칸 ${this.slot}로 연결했어요`,
        );
        return token;
      } catch (error) {
        if (stop.aborted) break;
        this.note((error as Error).message);
        await this.backoff.wait(stop);
      }
    }
    return null;
  }

  private async secret(): Promise<string> {
    const text = await readFile(this.file, 'utf8').catch(() => '');
    if (!text.trim()) throw new Error(`서버가 연결 값을 아직 쓰지 않았어요: ${this.file}`);
    return text.trim();
  }

  private async ask(secret: string, stop: AbortSignal): Promise<string> {
    let res: Response;
    try {
      const path = this.slot === null ? 'server-runner' : 'code-runner';
      res = await fetch(`${this.serverUrl}/api/devices/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.slot === null ? { secret } : { secret, slot: this.slot }),
        signal: AbortSignal.any([stop, AbortSignal.timeout(ServerPairing.TIMEOUT_MS)]),
      });
    } catch (error) {
      throw new Error(`서버에 닿지 못했어요: ${(error as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { token?: unknown; message?: unknown };
    if (res.ok && typeof body.token === 'string') return body.token;
    const why = typeof body.message === 'string' ? body.message : `오류 ${res.status}`;
    // 403: 서버 키가 바뀌었는데 서버가 아직 파일을 새로 쓰지 않음 등. 파일을 다시 읽고 다시 묻는다
    if (res.status === 403) throw new Error(`${why}. 서버가 연결 값을 새로 쓰기를 기다려요`);
    throw new Error(why);
  }

  private note(message: string): void {
    if (message === this.lastNote) return;
    this.lastNote = message;
    const who = this.slot === null ? '서버 러너' : `코드 러너 칸 ${this.slot}`;
    this.log.info(`${who} 연결을 기다려요: ${message}`);
  }
}
