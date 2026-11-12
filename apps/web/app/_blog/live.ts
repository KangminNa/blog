'use client';

import { api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import type { PageDetail, PageList } from './types';

// 여러 화면이 함께 쓰는 읽기.

/** 페이지가 생기거나, 새 판이 붙거나, 보이는 판 · 공개 범위가 바뀌면 온다 */
const PAGE_TOPICS = ['blog.page.changed'];

export function usePages() {
  return useLiveValue('pages', () => api<PageList>('GET', '/api/pages'), PAGE_TOPICS);
}

/** 페이지 하나와 판 목록 */
export function usePage(id: string) {
  return useLiveValue(`page:${id}`, () => api<PageDetail>('GET', `/api/pages/${id}`), PAGE_TOPICS);
}
