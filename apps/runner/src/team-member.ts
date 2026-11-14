import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/** 일을 맡길 수 있는 바로 아래 팀원 한 명 (위임) */
export class TeamMember {
  constructor(
    readonly agentId: string,
    readonly name: string,
    readonly role: string,
    readonly status: string,
    readonly kinds: readonly string[],
    /** 정해진 러너(관리자의 컴퓨터일 수 있음)에서만 일한다: 그 컴퓨터의 폴더를 읽는 일은 이 팀원에게 */
    readonly bound = false,
  ) {}

  static from(raw: Json): TeamMember {
    return new TeamMember(
      raw.text('agent_id'),
      raw.text('name'),
      raw.text('role'),
      raw.text('status'),
      raw.texts('kinds'),
      raw.flag('bound'),
    );
  }

  /** 지시문의 한 줄 (틀 member). 역할은 첫 줄만 */
  line(prompts: PromptPack): string {
    return prompts.fill('member', {
      name: this.name,
      id: this.agentId,
      role: this.role.split('\n')[0]?.trim() ?? '',
      kinds: this.kinds.join(', '),
      paused: this.status === 'paused',
      bound: this.bound,
    });
  }
}
