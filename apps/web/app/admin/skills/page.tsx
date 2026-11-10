import { SkillPanel } from './SkillPanel';

export const metadata = { title: '스킬 · Cairn', robots: { index: false } };

// 스킬 메뉴. 페이지는 틀만 두고, 읽기·쓰기는 클라이언트 패널이 서버 API로 한다.
export default function SkillPage() {
  return (
    <section className="console-inner narrow" aria-label="스킬">
      <SkillPanel />
    </section>
  );
}
