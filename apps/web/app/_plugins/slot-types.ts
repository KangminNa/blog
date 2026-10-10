import type { ReactNode } from 'react';

// 플러그인 화면이 받는 값. 자리마다 context가 정해져 있다.
//   post.after: 글 아래 — 글 id, 주소, 제목
export type SlotContext = { postId: string; slug: string; title: string; preview?: boolean };
export type SlotProps = { settings: Record<string, string>; context: SlotContext };
export type SlotEntry = { plugin: string; Component: (props: SlotProps) => ReactNode };
