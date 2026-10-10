import { ActionResult, type ArchiveFile, BaseJob } from '../../../apps/server/src/plugin-api';
import type { GithubGateway } from './github.gateway';

// 보관 형식 파일을 GitHub 브랜치에 맞춘다. 바뀐 파일만 올리고, 바뀐 게 없으면 커밋하지 않는다.
// 저장소가 공개면 vault(비공개가 기본인 세션·wiki)는 보내지 않는다.
export class SyncJob extends BaseJob {
  readonly name = 'sync';

  constructor(
    private readonly github: GithubGateway | null,
    private readonly branch: string,
    private readonly readArchive: () => Promise<readonly ArchiveFile[]>,
    private readonly missing: readonly string[],
  ) {
    super();
  }

  async run(): Promise<void> {
    const result = await this.syncOnce();
    if (!result.ok) throw new Error(result.message);
  }

  async syncOnce(): Promise<ActionResult> {
    if (!this.github) return ActionResult.failed('설정이 비어 있어요', this.missing);
    const repo = await this.github.repoInfo();
    const remote = await this.github.snapshot(this.branch);
    // 새 브랜치는 기본 브랜치에서 갈라지므로 기본 브랜치의 이력도 함께 본다
    const lineage = remote.headSha ? remote : await this.github.snapshot(repo.defaultBranch);
    if (!repo.isPrivate && lineage.hasPrivateArea()) {
      return ActionResult.failed('공개 저장소에 vault 파일이 있어요. 동기화를 멈췄어요', [
        '비공개 세션·wiki가 공개된 상태예요. 저장소를 private으로 바꾸세요',
        '파일을 지워도 git 이력에는 남아 있어요',
      ]);
    }
    const all = await this.readArchive();
    const files = repo.isPrivate ? all : all.filter((f) => !f.isPrivateArea());
    const skipped = all.length - files.length;
    const result = await this.github.commit(
      this.branch,
      remote,
      files,
      `cairn: 동기화 (${files.length}개 파일)`,
    );
    const notes = skipped > 0 ? [`저장소가 공개라 vault 파일 ${skipped}개는 보내지 않았어요`] : [];
    if (!result.didCommit) return ActionResult.done('바뀐 것이 없어요', notes);
    return ActionResult.done(
      `커밋 ${result.sha?.slice(0, 7)}: ${result.changed}개 올림, ${result.removed}개 지움`,
      notes,
    );
  }
}
