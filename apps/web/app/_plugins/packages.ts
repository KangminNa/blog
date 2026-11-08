'use client';

import { useEffect, useState } from 'react';
import type { PluginListView } from '../../../server/src/modules/platform/plugin/plugin.view';
import { api, describe } from '../_lib/client-api';
import type { PackageCall, PackageEntry } from './package-types';
import { PACKAGES } from './packages.generated';

type PluginList = ReturnType<PluginListView['toJSON']>;

// 콘솔이 쓰는 기능 패키지: 들어 있는 것(packages.generated.ts) 중 지금 동작 중인 것만 메뉴에 둔다.
// 동작 중인지는 서버에 묻는다 (켜고 끌 때 웹을 다시 빌드하지 않는다).
export function useActivePackages(): readonly PackageEntry[] {
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (PACKAGES.length === 0) return;
    api<PluginList>('GET', '/api/plugins').then((reply) => {
      if (reply.ok)
        setActive(new Set(reply.data.plugins.filter((p) => p.active).map((p) => p.name)));
    });
  }, []);
  return PACKAGES.filter((p) => active.has(p.plugin));
}

/** 들어 있는 패키지 하나 (주소의 이름으로) */
export function packageOf(plugin: string): PackageEntry | null {
  return PACKAGES.find((p) => p.plugin === plugin) ?? null;
}

/** 패키지 화면이 쓰는 서버 호출: /api/p/<패키지>/<경로> */
export function callFor(plugin: string): PackageCall {
  return async (method, path, body) => {
    const reply = await api<unknown>(method, `/api/p/${plugin}/${path.replace(/^\//, '')}`, body);
    return reply.ok
      ? { ok: true, data: reply.data }
      : { ok: false, message: describe(reply.error) };
  };
}
