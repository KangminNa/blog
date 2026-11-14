import type { ChatRow, ChatUpdateRow, TaskRow } from '../task.tables';

// 대화의 소식 응답 (MCP agent_updates · post_update, 대화 상세). 도구의 모양이라 snake_case (docs/API설계.md 4장).

/** 소식 한 줄과 남긴 에이전트의 이름 */
export type ChatUpdateLine = ChatUpdateRow & { agent: string | null };

/** 상태판의 대화 한 줄: 마지막 회차의 상태와 지금 도는 작업 수 */
export type ChatBoardRow = ChatRow & {
  partner: string;
  last_status: TaskRow['status'] | null;
  last_wait_reason: TaskRow['wait_reason'];
  active: number;
};

export class ChatUpdateView {
  constructor(private readonly row: Readonly<ChatUpdateLine>) {}

  toJSON() {
    const r = this.row;
    return {
      n: Number(r.n),
      chat_id: r.chat_id,
      kind: r.kind,
      text: r.text,
      agent: r.agent,
      task_id: r.task_id,
      created_at: r.created_at.toISOString(),
    };
  }
}

export class ChatBoardView {
  constructor(private readonly row: Readonly<ChatBoardRow>) {}

  /** working · waiting_approval · done · failed (마지막 회차로) */
  private get state(): string {
    const { last_status: status, last_wait_reason: reason } = this.row;
    if (status === 'waiting' && reason === 'approval') return 'waiting_approval';
    if (status === 'queued' || status === 'running' || status === 'waiting') return 'working';
    if (status === 'failed' || status === 'cancelled') return 'failed';
    return 'done';
  }

  toJSON() {
    const r = this.row;
    return {
      chat_id: r.id,
      title: r.title,
      goal: r.goal,
      project: r.project,
      partner: r.partner,
      state: this.state,
      active: Number(r.active),
      turns: r.turns,
      updated_at: r.updated_at.toISOString(),
    };
  }
}

/** agent_updates의 답: 새 소식(n 오름차순), 다음에 보낼 커서, 대화마다의 상태판 */
export class AgentUpdatesView {
  constructor(
    private readonly news: readonly ChatUpdateLine[],
    private readonly cursor: number,
    private readonly board: readonly ChatBoardRow[],
  ) {}

  toJSON() {
    return {
      news: this.news.map((r) => new ChatUpdateView(r).toJSON()),
      cursor: this.cursor,
      board: this.board.map((r) => new ChatBoardView(r).toJSON()),
    };
  }
}

/** post_update의 답 */
export class PostedUpdateView {
  constructor(private readonly n: number) {}

  toJSON() {
    return { n: this.n };
  }
}
