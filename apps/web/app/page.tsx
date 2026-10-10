import { GraphHome } from './_graph/GraphHome';
import { serverGet } from './_lib/server-api';
import type { Owner, SpaceInfo } from './_lib/types';

// 첫 화면 = 그래프 홈. 블로그 정보와 로그인한 주인을 서버에서 받아 그린다.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const [space, owner] = await Promise.all([
    serverGet<SpaceInfo>('/api/space'),
    serverGet<Owner>('/api/auth/me'),
  ]);
  if (!space)
    return (
      <main className="empty">
        <h1>서버에 연결하지 못했어요</h1>
        <p>서버(:4000)가 떠 있는지 확인해 주세요.</p>
      </main>
    );
  return <GraphHome space={space} owner={owner} />;
}
