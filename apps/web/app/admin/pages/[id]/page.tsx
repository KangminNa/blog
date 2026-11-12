import { PageDetailPanel } from '../PageDetailPanel';

export const metadata = { title: '페이지 · Cairn', robots: { index: false } };

export default async function PageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section className="console-inner wide" aria-label="페이지 상세">
      <PageDetailPanel key={id} id={id} />
    </section>
  );
}
