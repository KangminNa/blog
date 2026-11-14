'use client';

import { useEffect } from 'react';
import { useDevices } from '../_account/live';
import type { Device } from '../_account/types';
import { type ApiReply, api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import type {
  AgentList,
  AiTools,
  ApprovalPage,
  GoalList,
  GoalRunDetail,
  GoalRunList,
  Runner,
  RunnerList,
  ScheduleList,
  TaskPage,
  Usage,
} from './types';

// 여러 화면이 함께 쓰는 읽기.

export const TASK_TOPICS = ['task.task.changed'];
/** 작업 줄의 마지막 기록까지 따라간다 */
export const TASK_LOG_TOPICS = [...TASK_TOPICS, 'task.event.added'];
export const APPROVAL_TOPICS = ['task.approval.*'];
/** 목표 실행의 상태 · 회차가 바뀜 (회차 보고는 회차 작업이 끝날 때 함께 보인다) */
export const GOAL_RUN_TOPICS = ['task.goal_run.changed'];
/** 대화 목록: 보내면(task.chat.changed) · 회차 작업이 바뀌면 다시 읽는다 */
export const CHAT_TOPICS = ['task.chat.changed', 'task.task.changed'];
/** 대화 하나: 진행 기록(생각 중… 줄)과 결재까지 따라간다 */
export const CHAT_DETAIL_TOPICS = [...CHAT_TOPICS, 'task.event.added', 'task.approval.*'];
/** 실행 기록이 쌓이면 사용량이 바뀐다 */
export const AGENT_TOPICS = ['task.agent.changed', 'task.event.added'];
/** 구독 사용률이 오거나 실행 기록이 쌓이면 사용량이 바뀐다 */
export const USAGE_TOPICS = ['task.usage.changed', 'task.event.added'];
/** 시간이 지나 창이 끝나는 일에는 신호가 없다. 쉬던 에이전트가 돌아온 것이 보이게 이 간격으로도 읽는다 */
const USAGE_REREAD_MS = 60_000;

export function useAgents() {
  return useLiveValue('agents', () => api<AgentList>('GET', '/api/agents'), AGENT_TOPICS);
}

/** AI 도구마다의 로그인 상태. 연결 확인과 웹 로그인은 작업으로 돌아서 작업이 바뀔 때 다시 읽는다 */
export function useAiTools() {
  return useLiveValue('ai', () => api<AiTools>('GET', '/api/ai'), TASK_TOPICS);
}

/** 목표 나무. 목표마다 이어진 작업 수가 있어 작업이 바뀔 때도 다시 읽는다 */
export function useGoals() {
  return useLiveValue('goals', () => api<GoalList>('GET', '/api/goals'), TASK_TOPICS);
}

/** 목표 실행 목록 (최근부터) */
export function useGoalRuns() {
  return useLiveValue(
    'goal-runs',
    () => api<GoalRunList>('GET', '/api/goal-runs'),
    GOAL_RUN_TOPICS,
  );
}

/** 목표 실행 하나와 회차 보고 전부 */
export function useGoalRun(id: string) {
  return useLiveValue(
    `goal-run:${id}`,
    () => api<GoalRunDetail>('GET', `/api/goal-runs/${id}`),
    GOAL_RUN_TOPICS,
    id,
  );
}

export function useUsage() {
  const usage = useLiveValue('usage', () => api<Usage>('GET', '/api/usage'), USAGE_TOPICS);
  const { reload } = usage;
  useEffect(() => {
    const timer = setInterval(() => void reload(), USAGE_REREAD_MS);
    return () => clearInterval(timer);
  }, [reload]);
  return usage;
}

/** 스케줄 목록. 스케줄이 작업을 만들면 오늘 횟수와 다음 시각이 바뀌므로 작업이 바뀔 때도 다시 읽는다 */
export function useSchedules(agentId: string | null) {
  const query = agentId ? `?agentId=${agentId}` : '';
  return useLiveValue(
    `schedules:${agentId ?? ''}`,
    () => api<ScheduleList>('GET', `/api/schedules${query}`),
    TASK_TOPICS,
  );
}

/** 상태 하나의 작업 첫 쪽 (홈과 에이전트의 요약) */
export function useTasksIn(status: string) {
  return useLiveValue(
    `tasks:${status}`,
    () => api<TaskPage>('GET', `/api/tasks?status=${status}`),
    TASK_LOG_TOPICS,
  );
}

/** 결과를 페이지로 내보내는 일 가운데 아직 끝나지 않은 것 (페이지 메뉴의 "만드는 중"). 대기와 실행의 첫 쪽에서 고른다 */
export function usePageTasks() {
  const running = useTasksIn('running');
  const queued = useTasksIn('queued');
  // 두 목록은 따로 읽는다: 대기에서 실행으로 넘어가는 순간에는 같은 작업이 양쪽에 있을 수 있어 하나만 남긴다
  const byId = new Map(
    [...(queued.data?.tasks ?? []), ...(running.data?.tasks ?? [])].map((t) => [t.id, t]),
  );
  const tasks = [...byId.values()].filter((t) => t.page !== null);
  return { tasks, error: running.error ?? queued.error };
}

export function usePendingApprovals() {
  return useLiveValue(
    'approvals:pending',
    () => api<ApprovalPage>('GET', '/api/approvals?status=pending'),
    APPROVAL_TOPICS,
  );
}

/**
 * 커서 목록을 앞에서부터 pages쪽까지 읽어 하나로 합친다. 신호가 오면 읽어 둔 쪽을 모두 다시 읽는다:
 * 첫 쪽만 읽으면 뒤쪽 줄의 상태가 옛것으로 남고, 거르는 상태를 벗어난 줄이 사라지지 않는다.
 */
export async function readPages<Page extends { next: string | null }>(
  path: string,
  pages: number,
  merge: (before: Page, more: Page) => Page,
): Promise<ApiReply<Page>> {
  const join = path.includes('?') ? '&' : '?';
  let reply = await api<Page>('GET', path);
  for (let i = 1; i < pages && reply.ok && reply.data.next; i++) {
    const before: Page = reply.data;
    const more = await api<Page>('GET', `${path}${join}cursor=${before.next}`);
    reply = more.ok ? { ok: true, data: merge(before, more.data) } : more;
  }
  return reply;
}

/** 목록의 개수. 한 쪽을 넘으면 뒤에 + */
export function countOf(rows: readonly unknown[] | undefined, next: string | null | undefined) {
  if (rows === undefined) return '–';
  return `${rows.length}${next ? '+' : ''}`;
}

/** 러너와 그 기기 (이름은 기기의 것) */
export type RunnerChoice = { runner: Runner; device: Device };

/** 에이전트를 묶을 수 있는 러너: 끊기지 않은 기기의 일반 러너 (코드 러너 칸은 묶을 수 없다) */
export function useRunnerChoices(): readonly RunnerChoice[] {
  const runners = useLiveValue('runners', () => api<RunnerList>('GET', '/api/runners'), []);
  const devices = useDevices();
  const live = new Map(
    (devices.data?.devices ?? []).filter((d) => d.revokedAt === null).map((d) => [d.id, d]),
  );
  return (runners.data?.runners ?? []).flatMap((runner) => {
    const device = live.get(runner.deviceId);
    return device && !runner.sandbox ? [{ runner, device }] : [];
  });
}
