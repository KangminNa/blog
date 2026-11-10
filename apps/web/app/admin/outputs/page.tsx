import { OutputPanel } from './OutputPanel';

export const metadata = { title: '결과물 · Cairn', robots: { index: false } };

// 결과물: AI가 작업에서 만든 파일. 작업 상세에서 오면 그 작업의 것만 (주소의 task).
export default async function OutputPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>;
}) {
  const { task } = await searchParams;
  return (
    <section className="console-inner" aria-label="결과물">
      <OutputPanel taskId={task ?? null} />
    </section>
  );
}
