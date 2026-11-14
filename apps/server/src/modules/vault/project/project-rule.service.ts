import { Injectable } from '@nestjs/common';
import { type Actor, BaseService } from '../../platform';
import { ProjectRule } from './project-rule';
import type { SetProjectRuleInput } from './project-rule.input';
import { ProjectRuleRepository } from './project-rule.repository';

// 프로젝트 규칙 쓰기. 관리자만. 이미 쌓인 원문 · 세션은 그대로 두고 다음 원문부터 따른다
@Injectable()
export class ProjectRuleService extends BaseService {
  async set(actor: Actor, req: SetProjectRuleInput): Promise<void> {
    actor.assertOwner();
    const rule = ProjectRule.set(actor.requireSpace(), req.project, req.collect, new Date());
    await this.transaction((tx) => new ProjectRuleRepository(tx).save(rule));
  }
}
