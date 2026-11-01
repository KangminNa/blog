import type { ReactNode } from 'react';

// 콘솔 왼쪽 메뉴. 메뉴 하나 = app/admin/<주소>/ 폴더 하나 + 여기 한 줄. 기능이 생길 때 더한다.
const ICONS: Record<string, ReactNode> = {
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

export const MENU = [
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
