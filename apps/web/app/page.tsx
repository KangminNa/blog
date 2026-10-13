import { GraphHome } from './_graph/GraphHome';
import { serverGet } from './_lib/server-api';
import type { Owner, SessionPage, SpaceInfo } from './_lib/types';

// 첫 화면 = 그래프 홈. 블로그 정보와 로그인한 주인(주인이면 저장한 세션 수도)을 서버에서 받아 그린다.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const [space, owner, sessions] = await Promise.all([
    serverGet<SpaceInfo>('/api/space'),
    serverGet<Owner>('/api/auth/me'),
    serverGet<SessionPage>('/api/sessions'),
  ]);
  if (!space)
    return (
      <main className="empty">
        <h1>서버에 연결하지 못했어요</h1>
        <p>서버(:4000)를 띄웠는지 확인해 주세요.</p>
      </main>
    );
  return (
    <GraphHome
      space={space}
      owner={owner}
      saved={sessions ? { count: sessions.sessions.length, more: sessions.next !== null } : null}
    />
  );
}
