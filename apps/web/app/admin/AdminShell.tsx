'use client';

import { usePathname } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { api } from '../_lib/client-api';
import type { PackageEntry } from '../_plugins/package-types';
import { useActivePackages } from '../_plugins/packages';
import { countOf, usePendingApprovals } from '../_task/live';
import { CairnMark } from '../_ui/CairnMark';
import { ThemeToggle } from '../_ui/ThemeToggle';
import { useToast } from '../_ui/useToast';
import { useWaitingChanges } from '../_vault/live';
import { APPROVALS_HREF, HOME_HREF, MENU, MenuIcon } from './menu';
import { NotificationBell } from './NotificationBell';

/** 지금 메뉴인가. 홈(/admin)은 모든 메뉴의 앞부분이라 정확히 같을 때만 */
function isCurrent(pathname: string, href: string): boolean {
  return href === HOME_HREF ? pathname === href : pathname.startsWith(href);
}

const NotifyContext = createContext<(text: string) => void>(() => {});

/** 콘솔 아래쪽의 한 줄 알림 */
export function useNotify(): (text: string) => void {
  return useContext(NotifyContext);
}

// 콘솔의 틀: 왼쪽 메뉴 + 작업 칸. 좁은 화면에서는 메뉴가 서랍으로 열린다.
// 메뉴는 일반 링크로 둔다: 글 편집기의 "저장 안 한 내용" 확인(beforeunload)이 페이지를 떠날 때 돌아야 한다.
export function AdminShell({
  login,
  siteName,
  children,
}: {
  login: string;
  siteName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const packages = useActivePackages();
  const [open, setOpen] = useState(false);
  const [toast, showToast] = useToast();
  const pending = usePendingApprovals();
  const proposals = useWaitingChanges();
  const toDecide = [...(pending.data?.approvals ?? []), ...(proposals.data?.changes ?? [])];
  const pendingCount = toDecide.length
    ? countOf(toDecide, pending.data?.next ?? proposals.data?.next)
    : null;

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  async function logout() {
    await api('POST', '/api/auth/logout');
    window.location.href = '/';
  }

  return (
    <NotifyContext.Provider value={showToast}>
      <div className={open ? 'console open' : 'console'}>
        <button
          type="button"
          className="console-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setOpen(false)}
        />
        <aside className="console-side" aria-label="콘솔 메뉴">
          <a className="console-brand" href="/admin">
            <CairnMark />
            {siteName || 'Cairn'}
          </a>
          {MENU.map((group) => (
            <nav key={group.label} aria-label={group.label || '홈'}>
              {group.label && <div className="console-label">{group.label}</div>}
              {packages
                .filter((p) => p.group === group.label)
                .map((p) => (
                  <PackageLink key={p.plugin} entry={p} pathname={pathname} />
                ))}
              {group.items.map((item) => (
                <a
                  key={item.href}
                  className="console-link"
                  href={item.href}
                  aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                >
                  <MenuIcon name={item.icon} />
                  {item.name}
                  {item.href === APPROVALS_HREF && pendingCount && (
                    <span className="console-count">
                      <span className="sr">대기 </span>
                      {pendingCount}
                      <span className="sr">건</span>
                    </span>
                  )}
                </a>
              ))}
            </nav>
          ))}
          {[...new Set(packages.map((p) => p.group))]
            .filter((label) => !MENU.some((group) => group.label === label))
            .map((label) => (
              <nav key={`package-${label}`} aria-label={label || '기능 패키지'}>
                <div className="console-label">{label || '기능 패키지'}</div>
                {packages
                  .filter((p) => p.group === label)
                  .map((p) => (
                    <PackageLink key={p.plugin} entry={p} pathname={pathname} />
                  ))}
              </nav>
            ))}
          <div className="console-foot">
            <span className="label-mono">{login}</span>
            <a className="console-link" href="/">
              블로그 열기
            </a>
            <button type="button" className="console-link" onClick={logout}>
              로그아웃
            </button>
          </div>
        </aside>
        <div className="console-work">
          <header className="console-top">
            <button
              type="button"
              className="console-menu"
              aria-label="메뉴 열기"
              onClick={() => setOpen(true)}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
              </svg>
            </button>
            <span className="console-path">{pathname}</span>
            <NotificationBell />
            <ThemeToggle />
          </header>
          <div className="console-page">{children}</div>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </NotifyContext.Provider>
  );
}

/** 기능 패키지의 메뉴 한 줄 (목록 파일 menu). 화면은 /admin/p/<패키지> */
function PackageLink({ entry, pathname }: { entry: PackageEntry; pathname: string | null }) {
  const href = `/admin/p/${entry.plugin}`;
  return (
    <a
      className="console-link"
      href={href}
      aria-current={pathname?.startsWith(href) ? 'page' : undefined}
    >
      <MenuIcon name={entry.icon} />
      {entry.name}
    </a>
  );
}
