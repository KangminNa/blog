import type { Agent } from '../agent/agent';
import type { SkillPackage } from '../skill/skill-package';
import type { TaskRunNew } from '../task.tables';

// 실행 기록 한 줄 (task.task_runs): 이번 실행이 어떤 규칙으로 돌았나.
// 에이전트 설정 판, 스킬 판(출처 · 판 번호 · 해시), 지시문 틀(cairn-runner)의 판, 러너 빌드, CLI 버전. 일을 빌려 줄 때 한 번 만든다.
export class RunRecord {
  constructor(
    private readonly agent: Agent | null,
    private readonly skill: SkillPackage | null,
    /** 지시문 틀의 판. 에이전트 없는 일은 null */
    private readonly prompt: SkillPackage | null,
    private readonly runnerBuild: string | null,
    private readonly cliVersion: string | null,
  ) {}

  /** 그 작업 · 러너의 줄. 몇 번째 실행인지(seq)는 Repository가 매긴다 */
  row(id: string, spaceId: string, taskId: string, runnerId: string, now: Date): TaskRunNew {
    return {
      id,
      space_id: spaceId,
      task_id: taskId,
      seq: 0,
      runner_id: runnerId,
      agent_id: this.agent?.id ?? null,
      agent_revision: this.agent?.settingsRevision ?? null,
      skill: this.skill?.name ?? null,
      skill_source: this.skill?.source ?? null,
      skill_revision: this.skill?.revision ?? null,
      skill_hash: this.skill?.hash ?? null,
      prompt_source: this.prompt?.source ?? null,
      prompt_revision: this.prompt?.revision ?? null,
      prompt_hash: this.prompt?.hash ?? null,
      runner_build: this.runnerBuild,
      cli_version: this.cliVersion,
      started_at: now,
    };
  }
}
