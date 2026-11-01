// Pixel Agents의 core/src/messages.ts에서 이 플러그인이 쓰는 서버 → 화면 메시지만 옮겼다.
// AgentCreated의 seatId만 Cairn이 더한 칸이다: 나중에 생긴 에이전트도 다시 열었을 때 같은 자리에 앉게 한다.

export interface ProviderCapabilities {
  type: 'providerCapabilities';
  readingTools: string[];
  subagentToolNames: string[];
}

export interface AgentCreated {
  type: 'agentCreated';
  id: number;
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

export interface AgentClosed {
  type: 'agentClosed';
  id: number;
}

export interface AgentSeatMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

export interface ExistingAgents {
  type: 'existingAgents';
  agents: number[];
  agentMeta: Record<string, AgentSeatMeta>;
  directoryNames: Record<string, string>;
  externalAgents: Record<string, boolean>;
}

export type AgentActivityStatus = 'active' | 'waiting';

export interface AgentStatus {
  type: 'agentStatus';
  id: number;
  status: AgentActivityStatus;
}

export interface AgentToolStart {
  type: 'agentToolStart';
  id: number;
  toolId: string;
  status: string;
  toolName?: string;
}

export interface AgentToolDone {
  type: 'agentToolDone';
  id: number;
  toolId: string;
}

export interface AgentToolsClear {
  type: 'agentToolsClear';
  id: number;
}

export interface AgentToolPermission {
  type: 'agentToolPermission';
  id: number;
}

export interface AgentToolPermissionClear {
  type: 'agentToolPermissionClear';
  id: number;
}

export type ServerMessage =
  | ProviderCapabilities
  | AgentCreated
  | AgentClosed
  | ExistingAgents
  | AgentStatus
  | AgentToolStart
  | AgentToolDone
  | AgentToolsClear
  | AgentToolPermission
  | AgentToolPermissionClear;
