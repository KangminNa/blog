import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import type { AgentUser } from './agent-user';

/** 올릴 결과물 파일 하나. path는 러너가 읽을 곳 (코드 러너 칸이면 agent 권한으로 옮겨 둔 사본) */
export class OutputFile {
  constructor(
    readonly name: string,
    readonly path: string,
    readonly size: number,
    readonly sha256: string,
  ) {}

  /** 본문을 읽는다. 링크는 따라가지 않는다 (O_NOFOLLOW) */
  async open(): Promise<Readable> {
    const handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    return handle.createReadStream();
  }
}

// AI가 outputs 폴더에 둔 파일 중 결과물로 올릴 것 (기획서 결정 2026-11-10).
// 폴더 바로 아래의 보통 파일만: 폴더 · 링크 · 숨김 파일은 뺀다. 이름 · 한도는 서버(OutputPolicy)와 같고, 서버가 다시 본다.
// 뺀 것은 이유와 함께 남긴다 (실행 기록의 error): 사람이 무엇이 빠졌는지 알아야 한다.
// 코드 러너 칸에서는 AI가 셸을 가진 다른 사용자(agent)라 파일을 agent 권한으로 읽어 러너만의 폴더로 옮긴 뒤 올린다:
// AI가 파일을 링크로 바꿔 끼워도 root로 남의 파일을 읽지 않는다.
export class OutputBatch {
  static readonly FILE_MAX = 100 * 1024 * 1024;
  static readonly FILES_MAX = 200;
  static readonly BYTES_MAX = 1024 * 1024 * 1024;
  private static readonly NAME_MAX = 120;

  private constructor(
    readonly files: readonly OutputFile[],
    /** 뺀 파일과 이유 ("이름: 이유") */
    readonly skipped: readonly string[],
  ) {}

  /**
   * dir의 파일을 모은다. stage가 있으면(코드 러너 칸) agent 권한으로 그곳에 옮겨 두고 사본을 올린다.
   * 폴더가 없으면 빈 묶음
   */
  static async collect(
    dir: string,
    stage: string | null,
    agent: AgentUser | null,
    signal?: AbortSignal,
  ): Promise<OutputBatch> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const files: OutputFile[] = [];
    const skipped: string[] = [];
    let bytes = 0;
    /** 옮겨 둔 사본의 이름 (뺀 파일도 세어 겹치지 않게) */
    let copies = 0;
    if (stage) await mkdir(stage, { recursive: true, mode: 0o700 });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const { name } = entry;
      const problem = OutputBatch.nameProblem(name);
      if (problem) {
        skipped.push(`${name}: ${problem}`);
        continue;
      }
      if (!entry.isFile()) {
        skipped.push(`${name}: 폴더 바로 아래의 보통 파일만 올려요 (폴더 · 링크는 빼요)`);
        continue;
      }
      if (files.length >= OutputBatch.FILES_MAX) {
        skipped.push(`${name}: 실행 한 번에 ${OutputBatch.FILES_MAX}개까지예요`);
        continue;
      }
      let path = join(dir, name);
      if (stage && agent) {
        const copy = join(stage, String(copies++));
        if (!(await agent.copyOut(path, copy, OutputBatch.FILE_MAX, signal))) {
          skipped.push(`${name}: 읽지 못했거나 ${OutputBatch.mb(OutputBatch.FILE_MAX)}를 넘어요`);
          continue;
        }
        path = copy;
      }
      const info = await lstat(path);
      const reason = !info.isFile()
        ? '보통 파일이 아니에요'
        : info.size === 0
          ? '빈 파일이에요'
          : info.size > OutputBatch.FILE_MAX
            ? `파일 하나는 ${OutputBatch.mb(OutputBatch.FILE_MAX)}까지예요`
            : bytes + info.size > OutputBatch.BYTES_MAX
              ? `실행 한 번에 합쳐 ${OutputBatch.mb(OutputBatch.BYTES_MAX)}까지예요`
              : null;
      if (reason) {
        skipped.push(`${name}: ${reason}`);
        // 옮겨 둔 사본이면 지운다 (원본은 AI의 것이라 건드리지 않는다)
        if (stage && agent) await rm(path, { force: true });
        continue;
      }
      const file = new OutputFile(name, path, info.size, '');
      files.push(new OutputFile(name, path, info.size, await OutputBatch.hash(file)));
      bytes += info.size;
    }
    return new OutputBatch(files, skipped);
  }

  /** 서버의 이름 규칙(OutputPolicy.assertName)과 같다. 맞으면 null */
  static nameProblem(name: string): string | null {
    if (name.startsWith('.')) return '숨김 파일은 빼요';
    if (name.length > OutputBatch.NAME_MAX) return `이름은 ${OutputBatch.NAME_MAX}자까지예요`;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 거르는 것이 이 검사의 일이다
    if (name !== name.trim() || /[/\\\u0000-\u001f\u007f]/.test(name))
      return '이름에 앞뒤 공백 · 제어 문자를 쓸 수 없어요';
    return null;
  }

  private static async hash(file: OutputFile): Promise<string> {
    const digest = createHash('sha256');
    for await (const chunk of await file.open()) digest.update(chunk as Buffer);
    return digest.digest('hex');
  }

  private static mb(bytes: number): string {
    return bytes >= 1024 * 1024 * 1024
      ? `${bytes / 1024 / 1024 / 1024}GB`
      : `${bytes / 1024 / 1024}MB`;
  }
}
