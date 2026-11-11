import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pause } from './backoff';
import type { CairnServer } from './cairn-server';
import { ServerUnreachable, ToolRefused } from './mcp-client';

/** 재료가 그사이 휴지통에 갔거나 없어졌다. 그 파일만 빼고 이어 간다 */
export class MaterialGone extends Error {}

/** 받은 파일이 표와 다르거나 서버가 재료를 주지 않는다 (재료가 아님 · 임대를 잃음). 일을 실패로 끝낸다 */
export class MaterialBroken extends Error {}

/** 받아 둔 재료 파일 하나 */
export class MaterialFile {
  constructor(
    /** inputs/ 안의 이름 */
    readonly name: string,
    readonly size: number,
  ) {}
}

// 만들기 작업의 재료 결과물 하나 받기 (결과물 2차): begin_download로 표를 받고, 표의 주소에서 파일을 흘려 받는다.
// 올리기(OutputUploader)를 거울처럼 따른다: 닿지 못하거나 서버가 잠시 답하지 못하면(5xx · 표가 끝남) 표를 새로 받아 다시 받는다.
// 받으면서 크기를 세고 sha256을 맞춰 본다: 표와 다르면 파일을 남기지 않는다.
// 이름은 서버가 정한 결과물 이름이지만 믿지 않고 다시 거른다 (폴더 · 숨김 · 제어 문자 없이), 겹치면 번호를 붙인다.
export class MaterialDownloader {
  private static readonly TRIES = 4;
  private static readonly FIRST_WAIT_MS = 1_000;
  /** 파일 하나를 받는 데 쓰는 시간의 끝 (표가 10분이라 그보다 오래 매달리지 않는다) */
  private static readonly RECEIVE_MS = 10 * 60_000;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 막는 것이 목적이다
  private static readonly UNSAFE = /[/\\\u0000-\u001f\u007f]/;
  private static readonly NAME_MAX = 120;

  /** 이번 일에서 쓴 이름 (겹치지 않게) */
  private readonly taken = new Set<string>();

  constructor(
    private readonly server: CairnServer,
    private readonly serverUrl: string,
  ) {}

  /** 재료 하나를 dir에 받는다 */
  async download(
    taskId: string,
    outputId: string,
    dir: string,
    signal?: AbortSignal,
  ): Promise<MaterialFile> {
    let wait = MaterialDownloader.FIRST_WAIT_MS;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.once(taskId, outputId, dir, signal);
      } catch (error) {
        if (error instanceof ToolRefused) {
          if (error.code === 'not_found') throw new MaterialGone(error.message);
          throw new MaterialBroken(error.message);
        }
        if (error instanceof MaterialGone || error instanceof MaterialBroken) throw error;
        if (attempt >= MaterialDownloader.TRIES || signal?.aborted) throw error;
        await pause(wait, signal);
        wait *= 2;
      }
    }
  }

  private async once(
    taskId: string,
    outputId: string,
    dir: string,
    signal?: AbortSignal,
  ): Promise<MaterialFile> {
    const ticket = await this.server.beginDownload(taskId, outputId, signal);
    let res: Response;
    try {
      res = await fetch(new URL(ticket.path, this.serverUrl), {
        headers: { [ticket.header]: ticket.token },
        signal: AbortSignal.any([
          AbortSignal.timeout(MaterialDownloader.RECEIVE_MS),
          ...(signal ? [signal] : []),
        ]),
      });
    } catch (error) {
      throw new ServerUnreachable(`재료를 받지 못했어요: ${(error as Error).message}`);
    }
    if (res.status === 404) throw new MaterialGone('없거나 휴지통에 있는 결과물이에요');
    // 표가 끝났거나(403) 서버가 잠시 답하지 못함: 표를 새로 받아 다시
    if (!res.ok || res.body === null)
      throw new ServerUnreachable(`재료를 받지 못했어요 (${res.status})`);
    const name = this.nameFor(ticket.name, outputId);
    const path = join(dir, name);
    const hash = createHash('sha256');
    let size = 0;
    const counted = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > ticket.size) return done(new MaterialBroken('표에 적힌 크기보다 큰 재료예요'));
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(res.body as never),
        counted,
        createWriteStream(path, { flags: 'wx', mode: 0o600 }),
      );
    } catch (error) {
      await rm(path, { force: true });
      if (error instanceof MaterialBroken) throw error;
      throw new ServerUnreachable(`재료를 받다 끊겼어요: ${(error as Error).message}`);
    }
    if (size !== ticket.size || hash.digest('hex') !== ticket.sha256) {
      await rm(path, { force: true });
      throw new MaterialBroken(`받은 재료가 표와 달라요: ${ticket.name}`);
    }
    this.taken.add(name);
    return new MaterialFile(name, size);
  }

  /** 안전한 이름. 거를 것이 있으면 재료-<id 앞부분>, 겹치면 " (2)"처럼 번호 */
  private nameFor(given: string, outputId: string): string {
    const safe =
      given.length > 0 &&
      given.length <= MaterialDownloader.NAME_MAX &&
      !given.startsWith('.') &&
      !MaterialDownloader.UNSAFE.test(given)
        ? given
        : `재료-${outputId.slice(0, 8)}`;
    if (!this.taken.has(safe)) return safe;
    const ext = extname(safe);
    const stem = safe.slice(0, safe.length - ext.length);
    for (let n = 2; ; n++) {
      const next = `${stem} (${n})${ext}`;
      if (!this.taken.has(next)) return next;
    }
  }
}
