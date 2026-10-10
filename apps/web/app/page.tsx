// 개발 환경 확인용 첫 화면: 서버와 DB가 연결됐는지 보여준다.
export const dynamic = 'force-dynamic';

type Health = {
  status: string;
  extensions: Record<string, string>;
  migrations: string[];
  tables: Record<string, number>;
};

async function getHealth(): Promise<Health | { error: string }> {
  const base = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${base}/health`, { cache: 'no-store' });
    if (!res.ok) return { error: `서버 응답 ${res.status}` };
    return (await res.json()) as Health;
  } catch (e) {
    return { error: e instanceof Error ? e.message : '서버에 연결할 수 없어요' };
  }
}

export default async function Home() {
  const health = await getHealth();
  const ok = !('error' in health);

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '72px 24px', lineHeight: 1.7 }}>
      <p style={{ fontFamily: 'ui-monospace, monospace', color: '#8E887D', margin: 0 }}>
        cairn · 개발 환경
      </p>
      <h1 style={{ fontSize: 32, margin: '8px 0 24px' }}>
        {ok ? '서버와 DB가 연결됐어요' : '서버에 연결하지 못했어요'}
      </h1>
      {ok ? (
        <dl
          style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 16px', margin: 0 }}
        >
          <dt style={{ color: '#8E887D' }}>확장</dt>
          <dd style={{ margin: 0 }}>
            {Object.entries(health.extensions)
              .map(([name, version]) => `${name} ${version}`)
              .join(' · ')}
          </dd>
          <dt style={{ color: '#8E887D' }}>마이그레이션</dt>
          <dd style={{ margin: 0 }}>{health.migrations.length}개 적용</dd>
          <dt style={{ color: '#8E887D' }}>테이블</dt>
          <dd style={{ margin: 0 }}>
            {Object.entries(health.tables)
              .map(([schema, count]) => `${schema} ${count}`)
              .join(' · ')}
          </dd>
        </dl>
      ) : (
        <p style={{ color: '#E0AE8F' }}>{health.error}</p>
      )}
    </main>
  );
}
