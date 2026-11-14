import { BaseRequest } from '../../platform';
import { ProjectRule } from './project-rule';

/** 프로젝트의 모으기 켜기 · 끄기 (PUT /api/project-rules): { project, collect } */
export class SetProjectRuleInput extends BaseRequest {
  private constructor(
    readonly project: string,
    readonly collect: boolean,
  ) {
    super();
  }

  static from(raw: unknown): SetProjectRuleInput {
    return BaseRequest.read(
      raw,
      (f) => new SetProjectRuleInput(f.text('project', ProjectRule.NAME_MAX), f.boolean('collect')),
    );
  }
}
