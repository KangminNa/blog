'use client';

import { api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import type { PluginList } from './types';

// 여러 화면이 함께 쓰는 읽기 (platform).

/** 플러그인 목록 (플러그인 메뉴, 설치 마법사, 콘솔 메뉴의 기능 패키지). 변경 신호가 없어 처음과 다시 연결될 때만 읽는다 */
export function usePlugins() {
  return useLiveValue('plugins', () => api<PluginList>('GET', '/api/plugins'), []);
}
