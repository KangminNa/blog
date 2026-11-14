import { BaseRequest } from '../../platform';
import { Task } from './task';

/**
 * 다른 모듈이 에이전트 없이 서버의 로그인으로 돌릴 일을 요청한다 (이벤트 task.agentless.requested, 2차 4단계).
 * 내용 { requestId, kind, title, targetKind, targetId, baseVersion }. 일의 글(원문 등)은 싣지 않는다:
 * 러너가 일을 쥔 뒤 요청한 모듈의 도구로 받아 간다 (비공개 사본이 그 모듈 밖에 남지 않게). 받는 종류는 KINDS뿐
 */
export class AgentlessRequestInput extends BaseRequest {
  private static readonly KINDS: readonly string[] = [Task.SESSION_NOTE];

  private constructor(
    readonly requestId: string,
    readonly kind: string,
    readonly title: string,
    readonly targetKind: string,
    readonly targetId: string,
    readonly baseVersion: number | null,
  ) {
    super();
  }

  static from(raw: unknown): AgentlessRequestInput {
    return BaseRequest.read(raw, (f) => {
      const kind = f.text('kind', 40);
      if (!AgentlessRequestInput.KINDS.includes(kind))
        f.reject('kind', `에이전트 없이 맡을 수 있는 일이 아니에요: ${kind}`);
      return new AgentlessRequestInput(
        f.text('requestId', 200),
        kind,
        f.text('title', 200),
        f.text('targetKind', 40),
        f.uuid('targetId'),
        f.optionalInteger('baseVersion', 0, 2_147_483_647),
      );
    });
  }
}
