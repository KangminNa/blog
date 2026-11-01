import {
  ActionResult,
  type Actor,
  type ArchiveRestoreService,
  BaseAction,
} from '../../../apps/server/src/plugin-api';
import type { GithubGateway } from './github.gateway';

// 복원 미리 보기: 브랜치의 보관 파일을 받아 검사하고 무엇이 몇 개 들어올지 보여준다. 아무것도 쓰지 않는다.
export class RestorePreviewAction extends BaseAction {
  readonly label = '복원 미리 보기';

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
    const report = await this.restorer.preview(actor, files);
    return ActionResult.done(`들어올 내용: ${report.summary}`, [
      ...report.notes,
      '아직 아무것도 넣지 않았어요',
    ]);
  }
}
