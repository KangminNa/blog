import {
  ActionResult,
  type Actor,
  type ArchiveRestoreService,
  BaseAction,
} from '../../../apps/server/src/plugin-api';
import type { GithubGateway } from './github.gateway';

// 저장소에서 복원: 브랜치의 보관 파일을 받아 빈 Cairn에 들여온다. 비어 있지 않으면 아무것도 쓰지 않고 멈춘다.
export class RestoreAction extends BaseAction {
  readonly label = '저장소에서 복원';

  constructor(
    private readonly github: GithubGateway | null,
    private readonly branch: string,
    private readonly restorer: ArchiveRestoreService,
    private readonly missing: readonly string[],
  ) {
    super();
  }

  async run(actor: Actor): Promise<ActionResult> {
    actor.assertOwner();
    if (!this.github) return ActionResult.failed('설정이 비어 있어요', this.missing);
    const files = await this.github.download(this.branch);
    const report = await this.restorer.apply(actor, actor.spaceId, files);
    return ActionResult.done(`복원했어요: ${report.summary}`, [
      ...report.notes,
      '기기는 다시 연결해 주세요',
    ]);
  }
}
