import { Readable } from 'node:stream';
import { pause } from './backoff';
import type { CairnServer } from './cairn-server';
import { ServerUnreachable, ToolRefused } from './mcp-client';
import type { OutputFile } from './output-batch';

/** 서버가 이 파일을 받지 않음 (이름 · 한도 · 내용). 그 파일만 빼고 이어 간다 */
export class OutputRejected extends Error {}

// 결과물 하나 올리기: begin_upload로 표를 받고, 표의 주소에 파일을 흘려 보낸다 (MCP로 보내지 않는다: JSON 한도 512KB).
// 닿지 못하거나 서버가 잠시 답하지 못하면(5xx · 표가 끝남) 표를 새로 받아 다시 보낸다. 같은 실행 · 같은 이름은 서버에서 한 줄이라
// 응답을 잃고 다시 보내도 결과물은 하나다.
export class OutputUploader {
  private static readonly TRIES = 4;
  private static readonly FIRST_WAIT_MS = 1_000;
  /** 파일 하나를 보내는 데 쓰는 시간의 끝 (표가 10분이라 그보다 오래 매달리지 않는다) */
  private static readonly SEND_MS = 10 * 60_000;

  constructor(
    private readonly server: CairnServer,
    private readonly serverUrl: string,
  ) {}

  async upload(taskId: string, file: OutputFile, signal?: AbortSignal): Promise<void> {
    let wait = OutputUploader.FIRST_WAIT_MS;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.once(taskId, file, signal);
      } catch (error) {
        if (error instanceof ToolRefused) throw new OutputRejected(error.message);
        if (error instanceof OutputRejected || attempt >= OutputUploader.TRIES || signal?.aborted)
          throw error;
        await pause(wait, signal);
        wait *= 2;
      }
    }
  }

  private async once(taskId: string, file: OutputFile, signal?: AbortSignal): Promise<void> {
    const ticket = await this.server.beginUpload(taskId, file);
    let res: Response;
    try {
      res = await fetch(new URL(ticket.path, this.serverUrl), {
        method: 'PUT',
        headers: {
          [ticket.header]: ticket.token,
          'content-type': 'application/octet-stream',
          'content-length': String(file.size),
        },
        body: Readable.toWeb(await file.open()) as ReadableStream,
        duplex: 'half',
        signal: AbortSignal.any([
          AbortSignal.timeout(OutputUploader.SEND_MS),
          ...(signal ? [signal] : []),
        ]),
      } as RequestInit);
    } catch (error) {
      throw new ServerUnreachable(`결과물을 보내지 못했어요: ${(error as Error).message}`);
    }
    if (res.ok) return;
    const message = await OutputUploader.messageOf(res);
    // 표가 끝났거나(403) 서버가 잠시 답하지 못함: 표를 새로 받아 다시
    if (res.status === 403 || res.status >= 500) throw new ServerUnreachable(message);
    throw new OutputRejected(message);
  }

  private static async messageOf(res: Response): Promise<string> {
    const text = await res.text().catch(() => '');
    try {
      const body = JSON.parse(text) as { message?: unknown };
      if (typeof body.message === 'string') return body.message;
    } catch {
      // JSON이 아닌 답
    }
    return `서버가 받지 않았어요 (${res.status})`;
  }
}
