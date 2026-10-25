import type { Metadata } from 'next';
import '../../_blog/blog.css';
import { notFound } from 'next/navigation';
import { BlogHeader } from '../../_blog/BlogHeader';
import { formatDate, slugFrom } from '../../_blog/format';
import { renderMarkdown } from '../../_lib/markdown';
import { serverGet } from '../../_lib/server-api';
import type { PostPage, SpaceInfo } from '../../_lib/types';

// 글 페이지. 방문자는 공개·링크만 글을, 주인은 임시 글도 미리 본다 (서버가 보는 사람마다 거른다).
// 링크만·임시 글은 검색 엔진에 알리지 않는다 (noindex).
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

async function load(raw: string) {
  return serverGet<PostPage>(`/api/posts/by-slug/${encodeURIComponent(slugFrom(raw))}`);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [post, space] = await Promise.all([
    load((await params).slug),
    serverGet<SpaceInfo>('/api/space', true),
  ]);
  if (!post) return {};
  return {
    title: space?.name ? `${post.title} · ${space.name}` : post.title,
    description: post.excerpt,
    robots: post.listed ? undefined : { index: false, follow: false },
  };
}

export default async function PostView({ params }: Params) {
  const [post, space] = await Promise.all([
    load((await params).slug),
    serverGet<SpaceInfo>('/api/space', true),
  ]);
  if (!post) notFound();
  return (
    <div className="blog">
      <BlogHeader name={space?.name ?? ''} />
      <main className="blog-main">
        <article className="post">
          {post.status === 'draft' && (
            <p className="post-note">임시 글 미리 보기 · 방문자에게는 보이지 않아요</p>
          )}
          {post.status === 'unlisted' && (
            <p className="post-note">링크만 공개한 글 · 목록과 검색에는 보이지 않아요</p>
          )}
          <header className="post-head">
            <h1>{post.title}</h1>
            <div className="post-meta">
              {post.publishedAt && (
                <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
              )}
              {post.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          </header>
          <div
            className={`prose${post.align === 'center' ? ' center' : ''}`}
            // 서버의 md → HTML은 본문의 HTML을 그리지 않고 결과를 한 번 더 거른다 (_lib/markdown.ts)
            // biome-ignore lint/security/noDangerouslySetInnerHtml: 위에서 거른 HTML
            dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }}
          />
          <footer className="post-foot">
            <a href="/posts">← 글 목록</a>
          </footer>
        </article>
      </main>
    </div>
  );
}
