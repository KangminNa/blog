import type { ReactNode } from 'react';

// 콘솔 왼쪽 메뉴. 메뉴 하나 = app/admin/<주소>/ 폴더 하나 + 여기 한 줄. 기능이 생길 때 더한다.
// 2차 1-5: 처음 화면은 대화다 (왼쪽은 대화 목록). 아래 MENU는 "설정"에서 보인다.
const ICONS: Record<string, ReactNode> = {
  home: <path d="M2.5 7.2 8 2.6l5.5 4.6M4 6.4v7h8v-7" />,
  task: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="m5.2 8 2 2 3.6-4" />
    </>
  ),
  chat: <path d="M2.5 3.5h11v7.5H7.2L4.4 13.5V11H2.5z" />,
  scroll: <path d="M4 2.5h8v11H4zM6 5.5h4M6 8h4M6 10.5h2.5" />,
  wrench: (
    <path d="M10.6 2.6a3 3 0 0 0-3.8 3.9L2.6 10.7a1.2 1.2 0 0 0 1.7 1.7l4.2-4.2a3 3 0 0 0 3.9-3.8l-1.8 1.8-1.6-.4-.4-1.6z" />
  ),
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" />,
  box: <path d="M2.5 5 8 2.5 13.5 5v6.5L8 14l-5.5-2.5zM2.5 5 8 7.5 13.5 5M8 7.5V14" />,
  stamp: <path d="M6 2.5h4v3.2c0 1.2 2.8 1.6 2.8 4H3.2c0-2.4 2.8-2.8 2.8-4zM3 12.8h10" />,
  flag: <path d="M3.5 14V2.5M3.5 3h8.5l-2 3 2 3H3.5" />,
  runner: (
    <>
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
      <path d="M6.5 2v2M9.5 2v2M6.5 12v2M9.5 12v2M2 6.5h2M2 9.5h2M12 6.5h2M12 9.5h2" />
    </>
  ),
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
  window: (
    <>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.5" />
      <path d="M1.8 5.8h12.4M4 4.3h.1M6 4.3h.1" />
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
  graph: (
    <>
      <circle cx="4" cy="4.5" r="1.8" />
      <circle cx="12" cy="3.5" r="1.8" />
      <circle cx="8" cy="12" r="1.8" />
      <path d="M5.6 5.4 7 10.4M9.3 10.8l2-5.6M5.8 4.3l4.4-.6" />
    </>
  ),
  book: (
    <path d="M8 4.2C6.6 3 4.6 2.6 2.5 2.8v9.6c2.1-.2 4.1.2 5.5 1.4 1.4-1.2 3.4-1.6 5.5-1.4V2.8C11.4 2.6 9.4 3 8 4.2zM8 4.2v9.6" />
  ),
  bell: (
    <>
      <path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1.2H3z" />
      <path d="M6.6 14a1.5 1.5 0 0 0 2.8 0" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.6V8l2.4 1.6" />
    </>
  ),
  office: (
    <>
      <path d="M2 13.5h12M3.5 13.5V5L8 2.5 12.5 5v8.5" />
      <path d="M6.2 7h.8M9 7h.8M6.2 10h.8M9 10h.8" />
    </>
  ),
};

export const CHAT_HREF = '/admin';
export const CHATS_HREF = '/admin/chats';
export const APPROVALS_HREF = '/admin/approvals';
/** 설정의 첫 화면 (대화 칸 아래의 "설정") */
export const SETTINGS_HREF = '/admin/agents';

/** 대화 칸 (2차 1-5): 새 대화와 대화 하나 (/admin/chats/<id>). 왼쪽은 대화 목록이라 이 줄들은 메뉴로 그리지 않는다 */
export const CHAT_MENU = [
  { href: CHAT_HREF, name: '새 대화', icon: 'chat' },
  { href: CHATS_HREF, name: '대화', icon: 'chat' },
];

/** 설정: 대화 뒤에서 에이전트 · 러너 · 지식 · 블로그 · 연결을 다듬는 곳 */
export const MENU = [
  {
    label: '운영',
    items: [
      { href: SETTINGS_HREF, name: '에이전트', icon: 'people' },
      { href: APPROVALS_HREF, name: '결재', icon: 'stamp' },
      { href: '/admin/tasks', name: '작업', icon: 'task' },
      { href: '/admin/outputs', name: '결과물', icon: 'box' },
      { href: '/admin/goals', name: '목표', icon: 'flag' },
      { href: '/admin/runners', name: '러너', icon: 'runner' },
      { href: '/admin/skills', name: '스킬', icon: 'scroll' },
      { href: '/admin/tool-texts', name: '도구 설명', icon: 'wrench' },
      { href: '/admin/office', name: '오피스', icon: 'office' },
    ],
  },
  {
    label: '자동화',
    items: [
      { href: '/admin/schedules', name: '스케줄', icon: 'clock' },
      { href: '/admin/notices', name: '알림', icon: 'bell' },
    ],
  },
  {
    label: '지식',
    items: [
      { href: '/admin/sessions', name: '세션', icon: 'session' },
      { href: '/admin/graph', name: '그래프', icon: 'graph' },
      { href: '/admin/wiki', name: '위키', icon: 'book' },
    ],
  },
  {
    label: '블로그',
    items: [
      { href: '/admin/posts', name: '글', icon: 'post' },
      { href: '/admin/pages', name: '페이지', icon: 'window' },
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
