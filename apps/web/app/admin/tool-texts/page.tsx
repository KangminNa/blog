import { ToolTextPanel } from './ToolTextPanel';

export const metadata = { title: '도구 설명 · Cairn', robots: { index: false } };

// 도구 설명 메뉴. 페이지는 틀만 두고, 읽기·쓰기는 클라이언트 패널이 서버 API로 한다.
export default function ToolTextPage() {
  return (
    <section className="console-inner narrow" aria-label="도구 설명">
      <ToolTextPanel />
    </section>
  );
}
