import { TaskDetailPanel } from '../TaskDetailPanel';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section className="console-inner medium" aria-label="작업 상세">
      <TaskDetailPanel key={id} id={id} />
    </section>
  );
}
