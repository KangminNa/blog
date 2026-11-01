import { AgentsPanel } from './AgentsPanel';

// ?new=1: 다른 화면의 "에이전트 추가"에서 오면 입력 칸을 바로 연다.
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const { new: adding } = await searchParams;
  return (
    <section className="console-inner wide" aria-label="에이전트">
      <AgentsPanel adding={adding === '1'} />
    </section>
  );
}
