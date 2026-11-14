import type {
  AgentRow,
  ApprovalRow,
  ChatRow,
  ChatUpdateRow,
  OutputRow,
  TaskRow,
} from '../task.tables';

// 대화 묶음의 응답 모양. 웹이 `import type`으로 가져온다. view끼리는 서로 가져오지 못해서(경계 검사) 대화 · 소식을 한 파일에 둔다.
// REST(관리자만)는 camelCase, MCP 도구(agent_updates · post_update, docs/API설계.md 4장)는 snake_case.
// 회차 하나 = 관리자의 메시지(작업의 지시)와 상대의 답(작업의 결과). 결과물 · 기다리는 결재는 그 회차의 작업과 하위 작업의 것.

/** 대화 상대 (말을 걸 수 있는지 화면이 알린다. 막는 것은 서버의 Chat) */
export type ChatPartnerRow = Pick<AgentRow, 'name' | 'status' | 'reports_to' | 'deleted_at'>;
/** 회차 작업 한 줄 + 마지막 진행 기록과 끝나지 않은 하위 작업 수 */
export type ChatTurnTaskRow = TaskRow & { last_event: string | null; open_subtasks: number };
/** 회차(맨 위 작업 root)와 그 아래에서 만든 결과물 */
export type ChatOutputRow = Pick<OutputRow, 'id' | 'name' | 'kind'> & { root: string };
/** 결과 카드에 실린 결과물 (2차 2단계) */
export type ChatCardOutputRow = Pick<OutputRow, 'id' | 'name' | 'kind' | 'mime'>;
/** 회차(맨 위 작업 root)와 그 아래에서 기다리는 결재 */
export type ChatApprovalRow = Pick<ApprovalRow, 'id'> & { root: string };
/** 소식 한 줄과 남긴 에이전트의 이름, 질문이면 고를 에이전트들 (role은 맡는 일: 역할의 첫 줄) */
export type ChatUpdateLine = ChatUpdateRow & {
  agent: string | null;
  choice_list: Pick<AgentRow, 'id' | 'name' | 'role'>[] | null;
};
/**
 * 상태판의 대화 한 줄: 상대 이름(맡기 전이면 null), 상태(SQL이 정한다: 맡기 전 routing · asking, 맡은 뒤 마지막 회차로
 * working · waiting_approval · done · failed), 지금 도는 작업 수 (마지막 회차와 그 덧붙인 말의 답 아래 전부)
 */
export type ChatBoardRow = ChatRow & { partner: string | null; state: string; active: number };

/** 대화 하나 (만들기 · 보내기의 응답, 목록 · 상세의 머리) */
export class ChatView {
  constructor(private readonly row: Readonly<ChatRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      /** 맡은 에이전트. 맡기 전(배정 · 질문 중)이면 null */
      agentId: r.agent_id,
      title: r.title,
      /** 맡기 전에 받은 첫 메시지 (맡으면 첫 회차의 메시지가 되고 null) */
      pending: r.pending ?? null,
      turns: r.turns,
      /** 기기(MCP ask_agent)가 연 대화면 그 기기 (기기 목록의 id). 관리자가 연 대화면 null */
      deviceId: r.device_id ?? null,
      /** 목표 한 줄과 프로젝트(host/owner/repo). 새 대화를 열 때 정한다 */
      goal: r.goal ?? null,
      project: r.project ?? null,
      /** 받을 것 (html · blog · browser · code). null이면 대화 답 */
      deliver: r.deliver ?? null,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** 대화 목록 (최근에 보낸 것부터): 맡은 에이전트의 이름과 상태 (routing · asking · working · waiting_approval · done · failed) */
export class ChatListView {
  constructor(private readonly rows: readonly ChatBoardRow[]) {}

  toJSON() {
    return {
      chats: this.rows.map((r) => ({
        ...new ChatView(r).toJSON(),
        agentName: r.partner,
        state: r.state,
        active: Number(r.active),
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
      /** 받을 것이 없어 서버가 다시 맡긴 회차 (메시지는 관리자의 글이 아니라 지시문 틀 result-check) */
      fix: (t.payload as { chat?: { fix?: unknown } } | null)?.chat?.fix === true,
      outputs: this.outputs
        .filter((o) => o.root === t.id)
        .map((o) => ({ id: o.id, name: o.name, kind: o.kind })),
      approvalIds: this.approvals.filter((a) => a.root === t.id).map((a) => a.id),
    };
  }
}

/**
 * 기다리는 결과 카드 (2차 2단계): 실린 결재(동작)와 결과물, 받을 것의 검사, 검토자 짝의 의견.
 * 항목은 한 모양이다 (kind: action · output). 결정은 POST /api/approvals/:id/decide { version, decision, note?, picked? }
 */
export class ChatCardView {
  constructor(
    private readonly card: Readonly<ApprovalRow>,
    private readonly actions: readonly ApprovalRow[],
    private readonly outputs: readonly ChatCardOutputRow[],
    private readonly deliver: string | null,
    private readonly passed: boolean,
    private readonly review: string | null,
  ) {}

  toJSON() {
    const c = this.card;
    return {
      id: c.id,
      version: c.version,
      turn: c.target_version,
      createdAt: c.created_at.toISOString(),
      items: [
        ...this.actions.map((a) => ({
          kind: 'action',
          id: a.id,
          label: a.action,
          action: a.action as string | null,
          targetKind: a.target_kind as string | null,
          targetId: a.target_id as string | null,
          note: a.note,
          mime: null as string | null,
        })),
        ...this.outputs.map((o) => ({
          kind: 'output',
          id: o.id,
          label: o.name,
          action: null as string | null,
          targetKind: null as string | null,
          targetId: null as string | null,
          note: null as string | null,
          mime: o.mime as string | null,
        })),
      ],
      /** 받을 것과 검사 (받을 것을 정하지 않았으면 deliver null, passed true) */
      deliver: this.deliver,
      passed: this.passed,
      /** 검토자 짝의 의견 (검토하지 않았으면 null) */
      review: this.review,
    };
  }
}

/**
 * 대화 하나와 회차들 (오래된 것부터, 최근 ChatQuery.TURNS개), 상태 · 최근 소식(과정), 결과 카드 (2차 2단계),
 * 맡기 전이면 지금 질문 (2차 1-5)
 */
export class ChatDetailView {
  constructor(
    private readonly chat: Readonly<ChatRow>,
    private readonly partner: Readonly<ChatPartnerRow> | null,
    private readonly turns: readonly ChatTurnView[],
    private readonly board: Readonly<ChatBoardRow> | null,
    private readonly news: readonly ChatUpdateLine[],
    private readonly question: Readonly<ChatUpdateLine> | null,
    private readonly card: ChatCardView | null,
  ) {}

  toJSON() {
    const p = this.partner;
    const q = this.question;
    return {
      chat: new ChatView(this.chat).toJSON(),
      /** 맡은 에이전트 (맡기 전이면 null) */
      partner: p
        ? {
            name: p.name,
            paused: p.status === 'paused',
            topLevel: p.reports_to === null,
            deleted: p.deleted_at !== null,
          }
        : null,
      turns: this.turns.map((t) => t.toJSON()),
      /** routing · asking · working · waiting_approval · done · failed, 지금 도는 작업 수 */
      state: this.board?.state ?? 'done',
      active: Number(this.board?.active ?? 0),
      /** 최근 소식 (오래된 것부터): 과정 · 맡기 전의 질문 · 답 · 맡음 */
      news: this.news.map((r) => ({
        n: Number(r.n),
        kind: r.kind,
        text: r.text,
        agent: r.agent,
        taskId: r.task_id,
        createdAt: r.created_at.toISOString(),
      })),
      /** 맡기 전의 지금 질문과 고를 에이전트 (choice로 답한다). 묻지 않았거나 맡았으면 null */
      question: q ? { text: q.text, choices: q.choice_list ?? [] } : null,
      /** 기다리는 결과 카드 (없으면 null) */
      card: this.card?.toJSON() ?? null,
    };
  }
}

// MCP agent_updates · post_update의 모양 (snake_case)

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
      /** question이면 고를 에이전트들 (ask_agent의 choice로 답한다). 아니면 null */
      choices: r.choice_list,
      created_at: r.created_at.toISOString(),
    };
  }
}

export class ChatBoardView {
  constructor(private readonly row: Readonly<ChatBoardRow>) {}

  toJSON() {
    const r = this.row;
    return {
      chat_id: r.id,
      title: r.title,
      goal: r.goal,
      project: r.project,
      /** 맡은 에이전트 (맡기 전이면 null, state는 routing · asking) */
      partner: r.partner,
      state: r.state,
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
