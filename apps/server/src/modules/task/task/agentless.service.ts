import { Injectable } from '@nestjs/common';
import { Actor, BaseService } from '../../platform';
import { AiLoginRepository } from '../ai/ai-login.repository';
import type { AgentlessRequestInput } from './agentless.input';
import { LeasePolicy } from './lease.policy';
import { Task } from './task';
import { TaskRepository } from './task.repository';

// 다른 모듈이 요청한 에이전트 없는 일 (2차 4단계, 세션 노트). 도구는 서버의 로그인에서 고른다 (배정 일과 같다):
// 쓸 수 있는 로그인이 없으면 Claude로 두고 대기열에서 기다린다 (로그인을 넣으면 밀린 일이 돈다).
// 같은 requestId는 작업 하나. 뒤의 일(에이전트의 일)이 먼저 돌게 우선순위를 낮게 둔다
@Injectable()
export class AgentlessService extends BaseService {
  private static readonly PRIORITY = -10;

  async request(actor: Actor, spaceId: string, req: AgentlessRequestInput): Promise<void> {
    actor.assertCan(Actor.RUN);
    const now = new Date();
    await this.transaction(async (tx) => {
      const usable = await new AiLoginRepository(tx).usableTools(spaceId, now);
      const tool = LeasePolicy.serverTool(usable) ?? LeasePolicy.PREFERRED;
      const task = Task.open(
        spaceId,
        req.requestId,
        {
          kind: req.kind,
          title: req.title,
          instruction: req.title,
          payload: { tool },
          target_kind: req.targetKind,
          target_id: req.targetId,
          base_version: req.baseVersion,
          priority: AgentlessService.PRIORITY,
        },
        now,
      );
      await new TaskRepository(tx).insertOnce(task);
    });
  }
}
