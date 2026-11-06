import { RunnerPanel } from './RunnerPanel';

export const metadata = { title: '러너 · Cairn', robots: { index: false } };

// 러너 메뉴. 페이지는 틀만 두고, 읽기·쓰기는 클라이언트 패널이 서버 API로 한다.
export default function RunnerPage() {
  return (
    <section className="console-inner narrow" aria-label="러너">
      <header className="page-head">
        <h1>러너</h1>
      </header>
      <RunnerPanel />
    </section>
  );
}
