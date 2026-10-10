import { ActionResult, Actor, BaseAction } from '../../../apps/server/src/plugin-api';
import type { GithubGateway } from './github.gateway';

// 연결 확인: 토큰으로 저장소를 읽을 수 있는지, 쓸 수 있는지, private인지, 브랜치가 있는지.
export class CheckAction extends BaseAction {
  readonly label = 'GitHub 연결 확인';

  constructor(
    private readonly github: GithubGateway | null,
    private readonly branch: string,
    private readonly missing: readonly string[],
  ) {
    super();
  }

  async run(actor: Actor): Promise<ActionResult> {
    actor.assertCan(Actor.WRITE);
    if (!this.github) return ActionResult.failed('설정이 비어 있어요', this.missing);
    const repo = await this.github.repoInfo();
    const remote = await this.github.snapshot(this.branch);
    const details = [
      repo.isPrivate
        ? 'private 저장소: 블로그와 vault를 모두 보내요'
        : '공개 저장소: 블로그만 보내요',
      repo.canPush ? '쓰기 권한: 있음' : '쓰기 권한: 없음 (토큰 권한을 확인하세요)',
      remote.headSha
        ? `브랜치 ${this.branch}: 있음 (보관 파일 ${[...remote.files.keys()].length}개)`
        : `브랜치 ${this.branch}: 없음 (첫 동기화 때 만들어요)`,
    ];
    if (!repo.canPush) return ActionResult.failed('저장소에 쓸 수 없어요', details);
    return ActionResult.done('연결됐어요', details);
  }
}
