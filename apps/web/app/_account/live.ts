'use client';

import { api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import type { DeviceList, SpaceInfo } from './types';

// 여러 화면이 함께 쓰는 읽기 (account).

/** 기기가 연결되거나 끊길 때의 신호. 권한을 바꾸거나 토큰을 만들 때는 신호가 없다 */
const DEVICE_TOPICS = ['account.device.*'];

/** 기기 목록. 끊은 기기도 들어 있다 */
export function useDevices() {
  return useLiveValue('devices', () => api<DeviceList>('GET', '/api/devices'), DEVICE_TOPICS);
}

/** 블로그 정보. 변경 신호가 없어 처음과 다시 연결될 때만 읽는다 */
export function useSpace() {
  return useLiveValue('space', () => api<SpaceInfo>('GET', '/api/space'), []);
}
