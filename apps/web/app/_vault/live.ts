'use client';

import { api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import type { Graph, WaitingChangePage } from './types';

// 지식 화면이 함께 쓰는 읽기.

/** 세션 저장, wiki·연결 변경, 글 이벤트가 오면 그래프를 다시 읽는다 */
export const GRAPH_TOPICS = ['vault.*', 'blog.post.*'];
export const CHANGE_TOPICS = ['vault.change.*'];

export function useGraph() {
  return useLiveValue('graph', () => api<Graph>('GET', '/api/graph'), GRAPH_TOPICS);
}

/** 검토를 기다리는 변경 첫 쪽 (결재 메뉴) */
export function useWaitingChanges() {
  return useLiveValue(
    'changes:waiting',
    () => api<WaitingChangePage>('GET', '/api/changes?status=waiting'),
    CHANGE_TOPICS,
  );
}
