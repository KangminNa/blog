import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { PromptPack } from './prompt-pack';

// 내 컴퓨터 러너가 AI에게 나눠 주는 폴더 (CAIRN_RUNNER_FOLDERS, 기획서 결정 2026-11-14).
// 이 러너에 묶인 에이전트의 일에만 연다 (서버가 job.agent.bound로 알린다): 아무 에이전트나 내 파일을 보지 않게.
// 원본을 AI에게 열지 않고 일마다 작업 자리(work/folders/<이름>)로 복사한다. 홈 막기(ClaudeCli.settings)는 그대로고,
// AI가 고쳐도 원본에 닿지 않는다. 숨김 파일 · .git · node_modules · 링크는 빼고, 한도에 닿으면 거기까지만 복사한다.
export class SharedFolders {
  static readonly MAX_BYTES = 50 * 1024 * 1024;
  static readonly MAX_FILES = 5000;
  /** 숨김(점으로 시작)이 아니어도 뺀다: 크고 AI가 읽을 일이 없다 */
  private static readonly SKIP: ReadonlySet<string> = new Set(['node_modules']);

  constructor(
    /** 절대 경로들 (RunnerConfig가 검사했다). 이름(마지막 칸)은 서로 다르다 */
    readonly paths: readonly string[],
    private readonly maxBytes = SharedFolders.MAX_BYTES,
    private readonly maxFiles = SharedFolders.MAX_FILES,
  ) {}

  /** 폴더들을 dir/<이름>으로 복사한다. 지시문 단락은 결과가 만든다 */
  async copyInto(dir: string): Promise<SharedCopy> {
    const budget = { bytes: this.maxBytes, files: this.maxFiles, cut: false };
    const copied: [string, number][] = [];
    for (const path of this.paths) {
      const name = basename(path);
      copied.push([name, await SharedFolders.copyTree(path, join(dir, name), budget)]);
    }
    return new SharedCopy(copied, budget.cut, this.maxBytes, this.maxFiles);
  }

  /** 하나의 폴더를 복사한다. 복사한 파일 수 */
  private static async copyTree(
    from: string,
    to: string,
    budget: { bytes: number; files: number; cut: boolean },
  ): Promise<number> {
    await mkdir(to, { recursive: true });
    const entries = (await readdir(from, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    let count = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SharedFolders.SKIP.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const source = join(from, entry.name);
      if (entry.isDirectory()) {
        count += await SharedFolders.copyTree(source, join(to, entry.name), budget);
        continue;
      }
      if (!entry.isFile()) continue;
      const { size } = await lstat(source);
      if (budget.files <= 0 || size > budget.bytes) {
        budget.cut = true;
        continue;
      }
      await copyFile(source, join(to, entry.name));
      budget.files -= 1;
      budget.bytes -= size;
      count += 1;
    }
    return count;
  }
}

/** 복사한 결과: AI에게 줄 지시문 단락 */
export class SharedCopy {
  constructor(
    /** [폴더 이름, 복사한 파일 수] */
    private readonly copied: readonly (readonly [string, number])[],
    /** 한도에 닿아 일부만 복사했다 */
    readonly cut: boolean,
    private readonly maxBytes: number,
    private readonly maxFiles: number,
  ) {}

  /** 지시문의 단락 (틀 folders · folder) */
  part(prompts: PromptPack): string {
    const folders = this.copied.map(([name, count]) =>
      prompts.fill('folder', { name, count: count.toLocaleString('ko-KR') }),
    );
    return prompts.fill('folders', {
      folders: folders.join('\n'),
      cut: this.cut,
      maxMb: Math.round(this.maxBytes / 1024 / 1024),
      maxFiles: this.maxFiles.toLocaleString('ko-KR'),
    });
  }
}
