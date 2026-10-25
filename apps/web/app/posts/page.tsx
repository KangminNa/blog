import type { Metadata } from 'next';
import '../_blog/blog.css';
import { BlogHeader } from '../_blog/BlogHeader';
import { formatDate, postPath } from '../_blog/format';
import { serverGet } from '../_lib/server-api';
import type { PostList, SpaceInfo } from '../_lib/types';

// 방문자의 글 목록: 공개한 글을 발행한 순서로. 주인이 열어도 방문자가 보는 그대로 (임시·링크만 글은 없음).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const space = await serverGet<SpaceInfo>('/api/space', true);
  return { title: space?.name ? `글 · ${space.name}` : '글', description: space?.description };
}

export default async function Posts({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const [space, list] = await Promise.all([
    serverGet<SpaceInfo>('/api/space', true),
    serverGet<PostList>(`/api/posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, true),
  ]);
  return (
    <div className="blog">
      <BlogHeader name={space?.name ?? ''} />
      <main className="blog-main">
        <section className="blog-intro">
          <h1>{space?.name || '글'}</h1>
          {space?.description && <p>{space.description}</p>}
        </section>
        {!list ? (
          <p className="blog-empty">글을 불러오지 못했어요</p>
        ) : list.posts.length === 0 ? (
          <p className="blog-empty">아직 공개한 글 없음</p>
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
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                </a>
              </li>
            ))}
          </ol>
        )}
        {list?.next && (
          <a className="blog-more" href={`/posts?cursor=${encodeURIComponent(list.next)}`}>
            이전 글 더 보기
          </a>
        )}
      </main>
    </div>
  );
}
