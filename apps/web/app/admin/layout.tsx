import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { serverGet } from '../_lib/server-api';
import type { Owner, SpaceInfo } from '../_lib/types';
import { AdminShell } from './AdminShell';

// 콘솔은 주인만. 로그인하지 않았으면 로그인한 뒤 콘솔로 돌아온다.
export const dynamic = 'force-dynamic';

export const metadata = { title: '콘솔 · Cairn', robots: { index: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [owner, space] = await Promise.all([
    serverGet<Owner>('/api/auth/me'),
    serverGet<SpaceInfo>('/api/space'),
  ]);
  if (space && !space.installed) redirect('/install');
  if (!owner) redirect('/login?return=/admin');
  return (
    <AdminShell login={owner.login} siteName={space?.name ?? ''}>
      {children}
    </AdminShell>
  );
}
