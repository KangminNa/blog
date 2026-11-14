import { GoalRunPanel } from '../../GoalRunPanel';

export const metadata = { title: '목표 실행 · Cairn', robots: { index: false } };

export default async function GoalRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section className="console-inner medium" aria-label="목표 실행">
      <GoalRunPanel key={id} id={id} />
    </section>
  );
}
