import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SpaceInfo } from '../_account/types';
import { formatDate, postPath } from '../_blog/format';
import type { PostList } from '../_blog/types';
import { serverGet } from '../_lib/server-api';

// 첫 화면 = 글 목록: 공개한 글을 발행한 순서로. 주인이 열어도 방문자가 보는 그대로 (초안·링크 공개 글은 없음).
export const dynamic = 'force-dynamic';

/** 예전 관리 시트 주소 (?sheet=이름). 이미 저장된 링크가 있어서 콘솔 주소로 넘긴다 */
const OLD_SHEETS: Record<string, string> = {
  sessions: '/admin/sessions',
  posts: '/admin/posts',
  blog: '/admin/site',
  plugins: '/admin/plugins',
  devices: '/admin/devices',
  account: '/admin/account',
};

type Search = { cursor?: string; sheet?: string; session?: string; error?: string };

export async function generateMetadata(): Promise<Metadata> {
  const space = await serverGet<SpaceInfo>('/api/space', true);
  return { title: space?.name || 'Cairn', description: space?.description };
}

function oldSheetPath({ sheet, session, error }: Search): string | null {
  const path = sheet ? OLD_SHEETS[sheet] : undefined;
  if (!path) return null;
  const query = new URLSearchParams();
  if (session) query.set('session', session);
  if (error) query.set('error', error);
  return query.size > 0 ? `${path}?${query}` : path;
}

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const moved = oldSheetPath(search);
  if (moved) redirect(moved);
  const { cursor } = search;
  const [space, list] = await Promise.all([
    serverGet<SpaceInfo>('/api/space', true),
    serverGet<PostList>(`/api/posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, true),
  ]);
  if (space && !space.installed) redirect('/install');
  return (
    <main className="blog-main">
      {space?.description && <p className="blog-intro">{space.description}</p>}
      {!space || !list ? (
        <p className="blog-empty">서버에 연결하지 못했어요</p>
      ) : list.posts.length === 0 ? (
        <p className="blog-empty">공개한 글 없음</p>
      ) : (
        <ol className="post-list">
          {list.posts.map((p) => (
            <li key={p.slug}>
              <a href={postPath(p.slug)}>
                <h2>{p.title}</h2>
                {p.excerpt && <p>{p.excerpt}</p>}
                <div className="post-meta">
                  <time dateTime={p.publishedAt ?? undefined}>{formatDate(p.publishedAt)}</time>
                  {p.tags.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
              </a>
            </li>
          ))}
        </ol>
      )}
      {list?.next && (
        <a className="blog-more" href={`/?cursor=${encodeURIComponent(list.next)}`}>
          이전 글 더 보기
        </a>
      )}
    </main>
  );
}
