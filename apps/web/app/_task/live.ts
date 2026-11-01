'use client';

import { useEffect } from 'react';
import { type ApiReply, api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import type { AgentList, ApprovalPage, TaskPage, Usage } from './types';

// 여러 화면이 함께 쓰는 읽기.

export const TASK_TOPICS = ['task.task.changed'];
/** 작업 줄의 마지막 기록까지 따라간다 */
export const TASK_LOG_TOPICS = [...TASK_TOPICS, 'task.event.added'];
export const APPROVAL_TOPICS = ['task.approval.*'];
/** 실행 기록이 쌓이면 사용량이 바뀐다 */
export const AGENT_TOPICS = ['task.agent.changed', 'task.event.added'];
/** 구독 사용률이 오거나 실행 기록이 쌓이면 사용량이 바뀐다 */
export const USAGE_TOPICS = ['task.usage.changed', 'task.event.added'];
/** 시간이 지나 창이 끝나는 일에는 신호가 없다. 쉬던 에이전트가 돌아온 것이 보이게 이 간격으로도 읽는다 */
const USAGE_REREAD_MS = 60_000;

export function useAgents() {
  return useLiveValue('agents', () => api<AgentList>('GET', '/api/agents'), AGENT_TOPICS);
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

/** 상태 하나의 작업 첫 쪽 (홈과 에이전트의 요약) */
export function useTasksIn(status: string) {
  return useLiveValue(
    `tasks:${status}`,
    () => api<TaskPage>('GET', `/api/tasks?status=${status}`),
    TASK_LOG_TOPICS,
  );
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
