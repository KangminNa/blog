import { PagesPanel } from './PagesPanel';

export const metadata = { title: '페이지 · Cairn', robots: { index: false } };

// 페이지: AI가 만든 HTML 묶음. 홈에서 페이지로 받기를 고르면 그 작업을 달고 온다 (주소의 task): 끝나면 그 페이지를 연다.
export default async function PagesPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>;
}) {
  const { task } = await searchParams;
  return (
    <section className="console-inner" aria-label="페이지">
      <PagesPanel watch={task ?? null} />
    </section>
  );
}
