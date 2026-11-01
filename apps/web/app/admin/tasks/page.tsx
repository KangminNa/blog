import { TasksPanel } from './TasksPanel';

// 작업: 기본은 보드. 상태별 목록은 주소에 둔다: 상세에서 돌아와도, 홈의 숫자를 눌러 와도 같은 목록이다.
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; ask?: string }>;
}) {
  const { status, ask } = await searchParams;
  return (
    <section className="console-inner wide" aria-label="작업">
      <header className="page-head">
        <h1>작업</h1>
      </header>
      <TasksPanel status={status ?? null} ask={ask === '1'} />
    </section>
  );
}
