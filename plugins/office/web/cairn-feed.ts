import type { AgentSeatMeta, ServerMessage } from './pixel/messages';
import type { MessageTransport, TransportState } from './pixel/transport';

// Cairn 데이터 → Pixel Agents 메시지. 둘 사이의 유일한 다리이고, 화면은 transport 자리에서 이 메시지만 받는다.
// 값이 바뀌는 만큼만 보낸다: 신호마다 다시 읽어도 캐릭터가 하던 동작을 멈추지 않는다.
// 이 파일은 DOM을 모른다. 읽기는 cairn-read.ts, 그리기는 stage.ts.

/** /api/agents의 한 줄에서 쓰는 칸 */
export type FeedAgent = { id: string; name: string; status: string };

/** /api/tasks의 한 줄에서 쓰는 칸 */
export type FeedTask = {
  id: string;
  agentId: string | null;
  title: string;
  lastEvent: string | null;
};

/** 한 번에 읽은 값 */
export type FeedSnapshot = {
  agents: readonly FeedAgent[];
  running: readonly FeedTask[];
  waiting: readonly FeedTask[];
  /** 새 일을 쉬는 에이전트 (/api/usage의 holding) */
  held: readonly string[];
  /** 실행 중인 작업의 실행 기록 종류 (read·write·result·error), 오래된 것부터 */
  events: Readonly<Record<string, readonly string[]>>;
};

export type DeskState = 'running' | 'waiting' | 'paused' | 'held' | 'idle';

/** 에이전트 한 명의 자리: 옆 목록의 한 줄이면서 캐릭터 하나 */
export type Desk = {
  pixelId: number;
  agentId: string;
  name: string;
  state: DeskState;
  /** 지금 작업 (캐릭터를 누르면 열린다) */
  task: FeedTask | null;
  tool: DeskTool;
};

/** 읽기 동작이면 Read, 그 밖에는 Write(입력 동작) */
type DeskTool = 'Read' | 'Write';

/** 캐릭터가 지금 하는 일 */
type Pose = { kind: 'work'; toolId: string; tool: DeskTool } | { kind: 'ask' } | { kind: 'rest' };

const TOOL_STATUS: Record<DeskTool, string> = { Read: 'Reading', Write: 'Writing' };
/** 캐릭터 그림 수 (pixel/constants.ts의 PALETTE_COUNT) */
const LOOKS = 6;
const PAUSED = 'paused';

/** 앉을 의자. room.ts가 같은 이름으로 의자를 놓는다 */
export function seatOf(index: number): string {
  return `seat-${index}`;
}

/** 마지막 읽기·쓰기 기록이 동작을 정한다. 아직 없으면 입력 동작 */
function toolOf(kinds: readonly string[] | undefined): DeskTool {
  const last = kinds?.findLast((kind) => kind === 'read' || kind === 'write');
  return last === 'read' ? 'Read' : 'Write';
}

/** 결재를 기다리는 작업이 가장 앞이다: 멈춘 에이전트여도 주인이 볼 일이 남아 있다 */
function stateOf(
  agent: FeedAgent,
  held: boolean,
  waiting: FeedTask | undefined,
  running: FeedTask | undefined,
): DeskState {
  if (waiting) return 'waiting';
  if (agent.status === PAUSED) return 'paused';
  if (held) return 'held';
  return running ? 'running' : 'idle';
}

/** 읽은 값을 자리 목록으로. 에이전트 하나에 자리 하나. pixelId는 아직 없다 */
export function readDesks(snapshot: FeedSnapshot): Omit<Desk, 'pixelId'>[] {
  // id가 시간순(UUIDv7)이라, 다시 열어도 같은 차례로 앉는다
  const agents = [...snapshot.agents].sort((a, b) => (a.id < b.id ? -1 : 1));
  return agents.map((agent) => {
    const waiting = snapshot.waiting.find((t) => t.agentId === agent.id);
    const running = snapshot.running.find((t) => t.agentId === agent.id);
    const task = waiting ?? running ?? null;
    return {
      agentId: agent.id,
      name: agent.name,
      state: stateOf(agent, snapshot.held.includes(agent.id), waiting, running),
      task,
      tool: toolOf(task ? snapshot.events[task.id] : undefined),
    };
  });
}

function poseOf(desk: Desk): Pose {
  if (desk.state === 'waiting') return { kind: 'ask' };
  if (desk.state !== 'running' || !desk.task) return { kind: 'rest' };
  return { kind: 'work', toolId: `${desk.task.id}:${desk.tool}`, tool: desk.tool };
}

/** 이전 동작 → 다음 동작. before가 null이면 캐릭터가 막 생겼다 (자리에 앉아 입력하는 모습으로 시작한다) */
function poseMessages(id: number, before: Pose | null, after: Pose): ServerMessage[] {
  if (after.kind === 'rest') {
    if (before?.kind === 'rest') return [];
    // Pixel의 waiting은 "차례가 끝남"이다. Cairn의 waiting(결재 대기)은 agentToolPermission으로 간다
    const end: ServerMessage = { type: 'agentStatus', id, status: 'waiting' };
    return before ? [{ type: 'agentToolsClear', id }, end] : [end];
  }
  const out: ServerMessage[] = [];
  const seated = before?.kind === 'work' || before?.kind === 'ask';
  if (!seated) out.push({ type: 'agentStatus', id, status: 'active' });
  if (after.kind === 'ask') {
    if (before?.kind !== 'ask') out.push({ type: 'agentToolPermission', id });
    return out;
  }
  if (before?.kind === 'ask') out.push({ type: 'agentToolPermissionClear', id });
  if (before?.kind === 'work' && before.toolId === after.toolId) return out;
  if (before?.kind === 'work') {
    out.push({ type: 'agentToolDone', id, toolId: before.toolId });
  }
  out.push({
    type: 'agentToolStart',
    id,
    toolId: after.toolId,
    status: TOOL_STATUS[after.tool],
    toolName: after.tool,
  });
  return out;
}

/** 캐릭터의 그림과 자리: 차례로 정해서 다시 열어도 같다 */
function seatMeta(pixelId: number): AgentSeatMeta {
  const index = pixelId - 1;
  return { palette: index % LOOKS, hueShift: 0, seatId: seatOf(index) };
}

/**
 * Pixel Agents 화면의 transport 자리. 서버 대신 읽은 값을 push로 받아 메시지로 바꾼다.
 * 화면 코드가 늦게 불러와져도 onMessage가 지금 상태를 처음부터 보내 주므로 빠지는 메시지가 없다.
 */
export class CairnFeed implements MessageTransport {
  readonly ready: Promise<void> = Promise.resolve();
  readonly state: TransportState = 'connected';

  private readonly handlers = new Set<(message: ServerMessage) => void>();
  private readonly pixelIds = new Map<string, number>();
  private desks: readonly Desk[] | null = null;
  private poses = new Map<number, Pose>();

  /** 화면이 보내는 메시지는 없다: 오피스는 보기만 한다 */
  send(): void {}

  onMessage(handler: (message: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    if (this.desks) for (const message of this.opening(this.desks)) handler(message);
    return () => this.handlers.delete(handler);
  }

  onStateChange(): () => void {
    return () => {};
  }

  dispose(): void {
    this.handlers.clear();
  }

  /** 새로 읽은 값을 받아 바뀐 만큼 메시지를 보내고, 옆 목록에 쓸 자리들을 돌려준다 */
  push(snapshot: FeedSnapshot): readonly Desk[] {
    const desks = readDesks(snapshot).map((desk) => ({
      ...desk,
      pixelId: this.pixelIdOf(desk.agentId),
    }));
    const messages = this.desks ? this.changes(desks) : this.opening(desks);
    this.desks = desks;
    this.poses = new Map(desks.map((desk) => [desk.pixelId, poseOf(desk)]));
    for (const handler of this.handlers) for (const message of messages) handler(message);
    return desks;
  }

  /** 캐릭터를 눌렀을 때 열 작업 */
  taskOf(pixelId: number): string | null {
    return this.desks?.find((desk) => desk.pixelId === pixelId)?.task?.id ?? null;
  }

  private pixelIdOf(agentId: string): number {
    const known = this.pixelIds.get(agentId);
    if (known !== undefined) return known;
    const next = this.pixelIds.size + 1;
    this.pixelIds.set(agentId, next);
    return next;
  }

  /** 지금 상태 전부. 처음 읽었을 때와 화면이 늦게 붙었을 때 보낸다 */
  private opening(desks: readonly Desk[]): ServerMessage[] {
    const ids = desks.map((desk) => desk.pixelId);
    return [
      { type: 'providerCapabilities', readingTools: ['Read'], subagentToolNames: [] },
      {
        type: 'existingAgents',
        agents: ids,
        agentMeta: Object.fromEntries(ids.map((id) => [id, seatMeta(id)])),
        directoryNames: {},
        externalAgents: {},
      },
      ...desks.flatMap((desk) => poseMessages(desk.pixelId, null, poseOf(desk))),
    ];
  }

  /** 앞서 보낸 값과 다른 것만 */
  private changes(desks: readonly Desk[]): ServerMessage[] {
    const staying = new Set(desks.map((desk) => desk.pixelId));
    const out: ServerMessage[] = [];
    for (const id of this.poses.keys()) {
      if (!staying.has(id)) out.push({ type: 'agentClosed', id });
    }
    for (const desk of desks) {
      const id = desk.pixelId;
      const before = this.poses.get(id) ?? null;
      if (!before) out.push({ type: 'agentCreated', id, ...seatMeta(id) });
      out.push(...poseMessages(id, before, poseOf(desk)));
    }
    return out;
  }
}
