import type { AgentRow, ApprovalRow, ChatRow, OutputRow, TaskRow } from '../task.tables';

// 대화의 읽기 모양 (관리자만 본다). 웹이 `import type`으로 가져온다.
// 회차 하나 = 관리자의 메시지(작업의 지시)와 상대의 답(작업의 결과). 결과물 · 기다리는 결재는 그 회차의 작업과 하위 작업의 것.

/** 목록 한 줄: 상대 이름과 마지막 회차의 상태를 함께 읽는다 */
export type ChatListRow = ChatRow & {
  agent_name: string;
  last_status: string | null;
  last_wait_reason: string | null;
};
/** 대화 상대 (말을 걸 수 있는지 화면이 알린다. 막는 것은 서버의 Chat) */
export type ChatPartnerRow = Pick<AgentRow, 'name' | 'status' | 'reports_to' | 'deleted_at'>;
/** 회차 작업 한 줄 + 마지막 진행 기록과 끝나지 않은 하위 작업 수 */
export type ChatTurnTaskRow = TaskRow & { last_event: string | null; open_subtasks: number };
/** 회차(맨 위 작업 root)와 그 아래에서 만든 결과물 */
export type ChatOutputRow = Pick<OutputRow, 'id' | 'name' | 'kind'> & { root: string };
/** 회차(맨 위 작업 root)와 그 아래에서 기다리는 결재 */
export type ChatApprovalRow = Pick<ApprovalRow, 'id'> & { root: string };

/** 대화 하나 (만들기 · 보내기의 응답, 목록 · 상세의 머리) */
export class ChatView {
  constructor(private readonly row: Readonly<ChatRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      agentId: r.agent_id,
      title: r.title,
      turns: r.turns,
      /** 기기(MCP ask_agent)가 연 대화면 그 기기 (기기 목록의 id). 관리자가 연 대화면 null */
      deviceId: r.device_id ?? null,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** 대화 목록 (최근에 보낸 것부터) */
export class ChatListView {
  constructor(private readonly rows: readonly ChatListRow[]) {}

  toJSON() {
    return {
      chats: this.rows.map((r) => ({
        ...new ChatView(r).toJSON(),
        agentName: r.agent_name,
        lastStatus: r.last_status,
        lastWaitReason: r.last_wait_reason,
      })),
    };
  }
}

/** 회차 하나: 메시지(작업의 지시)와 답(작업의 결과), 그 아래의 결과물 · 기다리는 결재 */
export class ChatTurnView {
  constructor(
    private readonly t: Readonly<ChatTurnTaskRow>,
    private readonly outputs: readonly ChatOutputRow[],
    private readonly approvals: readonly ChatApprovalRow[],
  ) {}

  toJSON() {
    const t = this.t;
    const result = (t.result ?? {}) as { text?: unknown; error?: unknown };
    const chat = (t.payload as { chat?: { turn?: unknown; via?: unknown } } | null)?.chat;
    return {
      turn: Number(chat?.turn ?? 0),
      taskId: t.id,
      taskVersion: t.version,
      /** 기기(MCP ask_agent)가 보낸 메시지인가 */
      fromDevice: chat?.via === 'device',
      message: t.instruction,
      status: t.status,
      waitReason: t.wait_reason,
      createdAt: t.created_at.toISOString(),
      finishedAt: t.finished_at?.toISOString() ?? null,
      reply: typeof result.text === 'string' ? result.text : null,
      error: typeof result.error === 'string' ? result.error : null,
      progress: t.last_event,
      openSubtasks: t.open_subtasks,
      outputs: this.outputs
        .filter((o) => o.root === t.id)
        .map((o) => ({ id: o.id, name: o.name, kind: o.kind })),
      approvalIds: this.approvals.filter((a) => a.root === t.id).map((a) => a.id),
    };
  }
}

/** 대화 하나와 회차들 (오래된 것부터, 최근 ChatQuery.TURNS개) */
export class ChatDetailView {
  constructor(
    private readonly chat: Readonly<ChatRow>,
    private readonly partner: Readonly<ChatPartnerRow>,
    private readonly turns: readonly ChatTurnView[],
  ) {}

  toJSON() {
    const p = this.partner;
    return {
      chat: new ChatView(this.chat).toJSON(),
      partner: {
        name: p.name,
        paused: p.status === 'paused',
        topLevel: p.reports_to === null,
        deleted: p.deleted_at !== null,
      },
      turns: this.turns.map((t) => t.toJSON()),
    };
  }
}

/**
 * MCP agent_reply: 기기가 연 대화의 마지막 회차. answered는 기다려도 더 바뀌지 않는 때
 * (끝남 · 실패 · 멈춤, 또는 관리자의 결재를 기다림: 결재는 콘솔에서만 한다)
 */
export class ChatReplyView {
  constructor(
    private readonly chat: Readonly<ChatRow>,
    private readonly turn: ChatTurnView | null,
    private readonly answered: boolean,
  ) {}

  toJSON() {
    return {
      chatId: this.chat.id,
      answered: this.answered,
      /** 콘솔에서 이 대화를 여는 주소 (결재 · 결과물 열기는 거기서) */
      consolePath: `/admin/chats?chat=${this.chat.id}`,
      turn: this.turn?.toJSON() ?? null,
    };
  }
}
