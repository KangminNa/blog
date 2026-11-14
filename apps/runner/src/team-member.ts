import type { Json } from './json';

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

  /** 지시문의 한 줄. 역할은 첫 줄만 */
  get line(): string {
    const role = this.role.split('\n')[0]?.trim();
    const paused = this.status === 'paused' ? ' (중지됨: 맡겨도 재개될 때까지 기다림)' : '';
    const bound = this.bound
      ? ' · 정해진 컴퓨터에서 일함 (그 컴퓨터의 폴더를 읽는 일은 이 팀원에게)'
      : '';
    return `- ${this.name} (agent_id: ${this.agentId})${role ? `: ${role}` : ''} · 맡길 수 있는 일: ${this.kinds.join(', ')}${paused}${bound}`;
  }
}
