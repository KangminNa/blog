import { GoalPanel } from './GoalPanel';

export const metadata = { title: '목표 · Cairn', robots: { index: false } };

// 목표 메뉴. 페이지는 틀만 두고, 읽기·쓰기는 클라이언트 패널이 서버 API로 한다.
export default function GoalPage() {
  return (
    <section className="console-inner narrow" aria-label="목표">
      <GoalPanel />
    </section>
  );
}
