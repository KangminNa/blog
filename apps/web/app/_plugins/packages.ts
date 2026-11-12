'use client';

import { api, describe } from '../_lib/client-api';
import { usePlugins } from '../_platform/live';
import type { PackageCall, PackageEntry } from './package-types';
import { PACKAGES } from './packages.generated';

// 콘솔이 쓰는 기능 패키지: 들어 있는 것(packages.generated.ts) 중 지금 동작 중인 것만 메뉴에 둔다.
// 동작 중인지는 서버에 묻는다 (켜고 끌 때 웹을 다시 빌드하지 않는다).
export function useActivePackages(): readonly PackageEntry[] {
  const plugins = usePlugins();
  const active = new Set(plugins.data?.plugins.filter((p) => p.active).map((p) => p.name));
  return PACKAGES.filter((p) => active.has(p.plugin));
}

/** 들어 있는 패키지 하나 (주소의 이름으로) */
export function packageOf(plugin: string): PackageEntry | null {
  return PACKAGES.find((p) => p.plugin === plugin) ?? null;
}

/** 패키지 화면이 쓰는 서버 호출: /api/p/<패키지>/<경로> */
/** 패키지 화면이 코어를 읽을 때 쓰는 앞머리 (예: 코드 메뉴의 담당 고르기가 /api/agents를 읽는다) */
const CORE = '/api/';

export function callFor(plugin: string): PackageCall {
  return async (method, path, body) => {
    // '/api/'로 시작하면 코어의 읽기(GET)만: 주인 세션 그대로라 새 권한은 없고, 쓰기는 패키지 경로로만
    const core = path.startsWith(CORE);
    if (core && method !== 'GET') return { ok: false, message: '코어 경로는 읽기만 해요' };
    const url = core ? path : `/api/p/${plugin}/${path.replace(/^\//, '')}`;
    const reply = await api<unknown>(method, url, body);
    return reply.ok
      ? { ok: true, data: reply.data }
      : { ok: false, message: describe(reply.error) };
  };
}
