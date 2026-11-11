import { WikiPanel } from './WikiPanel';

// 그래프의 "위키 열기"(?wiki=<id>)로 들어오면 그 위키를 바로 연다. ?view=score면 점수순 목록.
export default async function WikiPage({
  searchParams,
}: {
  searchParams: Promise<{ wiki?: string; view?: string }>;
}) {
  const { wiki, view } = await searchParams;
  return (
    <section className="console-inner wide" aria-label="위키">
      <header className="page-head">
        <h1>위키</h1>
      </header>
      <WikiPanel openId={wiki ?? null} view={view ?? null} />
    </section>
  );
}
