'use client';

import { usePathname } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { api } from '../_lib/client-api';
import { CairnMark } from '../_ui/CairnMark';
import { ThemeToggle } from '../_ui/ThemeToggle';
import { useToast } from '../_ui/useToast';
import { MENU, MenuIcon } from './menu';

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
  const [open, setOpen] = useState(false);
  const [toast, showToast] = useToast();

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
            <nav key={group.label} aria-label={group.label}>
              <div className="console-label">{group.label}</div>
              {group.items.map((item) => (
                <a
                  key={item.href}
                  className="console-link"
                  href={item.href}
                  aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                >
                  <MenuIcon name={item.icon} />
                  {item.name}
                </a>
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
