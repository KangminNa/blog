import type { Metadata } from 'next';
import type { SpaceInfo } from '../../_account/types';
import { formatDate, pagePath } from '../../_blog/format';
import type { PublicPageList } from '../../_blog/types';
import { serverGet } from '../../_lib/server-api';

// 공개 페이지 목록: 주인이 공개로 바꾼 페이지를 고친 순서로. 주인이 열어도 방문자가 보는 그대로 (비공개 페이지는 없다).
// 페이지 하나(/pages/<이름>/…)는 이 화면이 아니라 서버가 내보낸다 (next.config의 rewrites).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const space = await serverGet<SpaceInfo>('/api/space', true);
  return { title: `페이지 · ${space?.name || 'Cairn'}` };
}

export default async function PublicPages() {
  const list = await serverGet<PublicPageList>('/api/pages', true);
  return (
    <main className="blog-main">
      {!list ? (
        <p className="blog-empty">서버에 연결하지 못했어요</p>
      ) : list.pages.length === 0 ? (
        <p className="blog-empty">공개한 페이지 없음</p>
      ) : (
        <ol className="post-list">
          {list.pages.map((p) => (
            <li key={p.name}>
              <a href={pagePath(p.name)}>
                <h2>{p.title}</h2>
                <div className="post-meta">
                  <time dateTime={p.updatedAt}>{formatDate(p.updatedAt)}</time>
                </div>
              </a>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
