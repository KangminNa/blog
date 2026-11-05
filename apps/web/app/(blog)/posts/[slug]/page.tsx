import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SpaceInfo } from '../../../_account/types';
import { formatDate, slugFrom } from '../../../_blog/format';
import type { PostPage } from '../../../_blog/types';
import { renderMarkdown } from '../../../_lib/markdown';
import { serverGet } from '../../../_lib/server-api';
import { Slot } from '../../../_plugins/Slot';

// 글 페이지. 방문자는 공개·링크 공개 글을, 주인은 초안도 미리 본다 (서버가 보는 사람마다 거른다).
// 링크 공개·초안은 검색 엔진에 알리지 않는다 (noindex).
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
  const post = await load((await params).slug);
  if (!post) notFound();
  return (
    <main className="blog-main">
      <article className="post">
        {post.status === 'draft' && (
          <p className="post-note">초안 미리 보기 · 방문자에게 안 보임</p>
        )}
        {post.status === 'unlisted' && (
          <p className="post-note">링크 공개 글 · 목록과 검색에 안 보임</p>
        )}
        <header className="post-head">
          <h1>{post.title}</h1>
          <div className="post-meta">
            {post.publishedAt && (
              <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
            )}
            {post.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
        </header>
        <div
          className={`prose${post.align === 'center' ? ' center' : ''}`}
          // 서버의 md → HTML은 본문의 HTML을 그리지 않고 결과를 한 번 더 거른다 (_lib/markdown.ts)
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 위에서 거른 HTML
          dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }}
        />
        <Slot
          name="post.after"
          context={{ postId: post.slug, slug: post.slug, title: post.title }}
        />
        <footer className="post-foot">
          <a href="/">← 글 목록</a>
        </footer>
      </article>
    </main>
  );
}
