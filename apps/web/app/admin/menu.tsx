import type { ReactNode } from 'react';

// 콘솔 왼쪽 메뉴. 메뉴 하나 = app/admin/<주소>/ 폴더 하나 + 여기 한 줄. 기능이 생길 때 더한다.
const ICONS: Record<string, ReactNode> = {
  home: <path d="M2.5 7.2 8 2.6l5.5 4.6M4 6.4v7h8v-7" />,
  task: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="m5.2 8 2 2 3.6-4" />
    </>
  ),
  stamp: <path d="M6 2.5h4v3.2c0 1.2 2.8 1.6 2.8 4H3.2c0-2.4 2.8-2.8 2.8-4zM3 12.8h10" />,
  people: (
    <>
      <circle cx="5.6" cy="5.4" r="2.2" />
      <path d="M1.8 13c.5-2.3 1.9-3.4 3.8-3.4s3.3 1.1 3.8 3.4" />
      <path d="M10.2 3.5a2.2 2.2 0 0 1 0 4M11 9.8c1.7.3 2.8 1.3 3.2 3.2" />
    </>
  ),
  session: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M4.8 6.2 7 8l-2.2 1.8M8.6 10h2.8" />
    </>
  ),
  post: (
    <>
      <path d="M4 1.8h5.5L12.5 5v9.2H4z" />
      <path d="M6 8h4.5M6 10.8h4.5" />
    </>
  ),
  device: (
    <>
      <rect x="1.8" y="3" width="12.4" height="8.4" rx="1.5" />
      <path d="M5.5 13.5h5" />
    </>
  ),
  plug: <path d="M6 1.8v3.4M10 1.8v3.4M4.2 5.2h7.6V8a3.8 3.8 0 0 1-7.6 0zM8 11.8v2.4" />,
  site: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.4" r="2.8" />
      <path d="M2.8 14c.8-2.8 2.7-4 5.2-4s4.4 1.2 5.2 4" />
    </>
  ),
  basket: <path d="M2.2 6h11.6l-1 7.2H3.2zM5.2 6 7 2.4M10.8 6 9 2.4" />,
};

export const HOME_HREF = '/admin';
export const APPROVALS_HREF = '/admin/approvals';

export const MENU = [
  { label: '', items: [{ href: HOME_HREF, name: '홈', icon: 'home' }] },
  {
    label: '운영',
    items: [
      { href: '/admin/tasks', name: '작업', icon: 'task' },
      { href: APPROVALS_HREF, name: '결재', icon: 'stamp' },
      { href: '/admin/agents', name: '에이전트', icon: 'people' },
    ],
  },
  { label: '지식', items: [{ href: '/admin/sessions', name: '세션', icon: 'session' }] },
  {
    label: '블로그',
    items: [
      { href: '/admin/posts', name: '글', icon: 'post' },
      { href: '/admin/basket', name: '소재', icon: 'basket' },
    ],
  },
  {
    label: '연결',
    items: [
      { href: '/admin/devices', name: '기기', icon: 'device' },
      { href: '/admin/ai', name: 'AI', icon: 'session' },
      { href: '/admin/plugins', name: '플러그인', icon: 'plug' },
    ],
  },
  {
    label: '설정',
    items: [
      { href: '/admin/site', name: '사이트', icon: 'site' },
      { href: '/admin/account', name: '계정', icon: 'user' },
    ],
  },
];

export function MenuIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
