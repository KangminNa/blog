import type { ReactNode } from 'react';

// 플러그인 화면이 받는 값. 자리마다 context가 정해져 있다.
//   post.after: 글 아래 — 글 id, 주소, 제목
//   task.office: 콘솔의 오피스 — 넘기는 값 없음
export type SlotContext =
  | { postId: string; slug: string; title: string; preview?: boolean }
  | Record<string, never>;
export type SlotProps = { settings: Record<string, string>; context: SlotContext };
/** 메서드 꼴로 둔다: 화면마다 자기 자리의 context만 받아도 들어갈 수 있게 (속성 꼴은 매개변수를 엄격하게 비교한다) */
export type SlotEntry = { plugin: string; Component(props: SlotProps): ReactNode };
