import { SessionsPanel } from './SessionsPanel';

// AI 도구의 save_session 응답 링크(?session=<id>)로 들어오면 그 세션을 바로 연다.
export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  return (
    <section className="console-inner" aria-label="세션">
      <header className="page-head">
        <h1>세션</h1>
      </header>
      <SessionsPanel initialId={session ?? null} />
    </section>
  );
}
