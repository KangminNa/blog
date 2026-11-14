import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Owner, SpaceInfo } from '../_account/types';
import { serverGet } from '../_lib/server-api';
import type { PluginList } from '../_platform/types';
import { AdminShell } from './AdminShell';

// 콘솔은 주인만. 로그인하지 않았으면 로그인한 뒤 콘솔로 돌아온다.
export const dynamic = 'force-dynamic';

export const metadata = { title: '콘솔 · Cairn', robots: { index: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [owner, space, plugins] = await Promise.all([
    serverGet<Owner>('/api/auth/me'),
    serverGet<SpaceInfo>('/api/space'),
    // 기능 패키지 메뉴를 처음부터 그리려고 (화면에서 읽으면 메뉴가 늦게 끼어들어 줄이 밀린다)
    serverGet<PluginList>('/api/plugins'),
  ]);
  if (space && !space.installed) redirect('/install');
  if (!owner) redirect('/login?return=/admin');
  return (
    <AdminShell
      ownerName={owner.name}
      siteName={space?.name ?? ''}
      logoUrl={space?.logoUrl ?? null}
      activePlugins={plugins?.plugins.filter((p) => p.active).map((p) => p.name) ?? []}
    >
      {children}
    </AdminShell>
  );
}
