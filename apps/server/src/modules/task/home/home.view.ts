import type { AgentRow, ChatRow, OutputRow } from '../task.tables';

// 홈의 읽기 모양 (관리자만, 2차 1-1). 웹이 `import type`으로 가져온다.
// 홈은 대화로 일을 맡기고 결과만 보는 곳이라 팀 · 진행 중인 대화 · 최근 결과물 · 기다리는 결재 수만 싣는다.

/** 관리자 바로 아래 에이전트 하나: 아래 에이전트 수와 그 팀 전체에서 도는 작업 수 */
export type HomeTeamRow = Pick<AgentRow, 'id' | 'name' | 'role' | 'status' | 'lead'> & {
  members: number;
  open: number;
};
/** 대화 하나의 상태판 (ChatUpdateQuery.ownerBoard가 정한 상태 · 도는 작업 수) */
export type HomeChatRow = Pick<
  ChatRow,
  'id' | 'title' | 'goal' | 'project' | 'turns' | 'updated_at'
> & {
  partner: string;
  state: string;
  active: number;
};
/** 최근 결과물 한 줄 */
export type HomeOutputRow = Pick<
  OutputRow,
  'id' | 'name' | 'kind' | 'mime' | 'size_bytes' | 'task_id' | 'created_at'
>;

export class HomeView {
  constructor(
    private readonly team: readonly HomeTeamRow[],
    private readonly chats: readonly HomeChatRow[],
    private readonly outputs: readonly HomeOutputRow[],
    private readonly pendingApprovals: number,
  ) {}

  toJSON() {
    return {
      /** 기본 대표가 먼저, 다음은 이름순 */
      team: this.team.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        lead: a.lead,
        paused: a.status === 'paused',
        members: a.members,
        open: a.open,
      })),
      /** 최근에 바뀐 대화부터. state: working · waiting_approval · done · failed */
      chats: this.chats.map((c) => ({
        id: c.id,
        title: c.title,
        goal: c.goal,
        project: c.project,
        partner: c.partner,
        state: c.state,
        active: Number(c.active),
        turns: c.turns,
        updatedAt: c.updated_at.toISOString(),
      })),
      /** 최근 결과물 (휴지통 제외) */
      outputs: this.outputs.map((o) => ({
        id: o.id,
        name: o.name,
        kind: o.kind,
        mime: o.mime,
        sizeBytes: Number(o.size_bytes),
        taskId: o.task_id,
        createdAt: o.created_at.toISOString(),
      })),
      /** 관리자를 기다리는 결재 수 */
      pendingApprovals: this.pendingApprovals,
    };
  }
}
