import { SchedulesPanel } from './SchedulesPanel';

export const metadata = { title: '스케줄 · Cairn', robots: { index: false } };

// 스케줄: 정한 시각에 작업을 만든다. 에이전트 화면에서 오면 그 에이전트가 담당인 것만 (주소의 agent).
export default async function SchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const { agent } = await searchParams;
  return (
    <section className="console-inner" aria-label="스케줄">
      <SchedulesPanel agentId={agent ?? null} />
    </section>
  );
}
