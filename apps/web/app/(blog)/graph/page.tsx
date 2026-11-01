import type { Metadata } from 'next';
import { serverGet } from '../../_lib/server-api';
import type { SpaceInfo } from '../../_lib/types';
import { GraphBoard } from '../../_vault/GraphBoard';
import type { Graph } from '../../_vault/types';

// 공개 그래프. 주인이 열어도 방문자가 보는 그대로이고, 비공개는 서버에서 거른 뒤에 온다.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const space = await serverGet<SpaceInfo>('/api/space', true);
  return { title: space?.name ? `그래프 · ${space.name}` : '그래프' };
}

export default async function PublicGraph() {
  const graph = await serverGet<Graph>('/api/graph/public', true);
  return (
    <main className="blog-graph">
      <h1 className="sr">그래프</h1>
      {graph ? (
        <GraphBoard graph={graph} admin={false} />
      ) : (
        <p className="blog-empty">서버에 연결하지 못했어요</p>
      )}
    </main>
  );
}
