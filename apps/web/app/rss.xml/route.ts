import { postPath } from '../_blog/format';
import { serverGet } from '../_lib/server-api';
import type { PostList, PostSummary, SpaceInfo } from '../_lib/types';

// RSS: 공개 글 20개를 발행한 순서로 (서버의 글 목록 한 쪽이 20개다). 방문자로 묻는다: 주인이 열어도 공개 글만.
// 서버에 닿지 못하면 빈 피드 대신 503을 준다: 구독기가 글이 다 사라졌다고 여기지 않게.
export const dynamic = 'force-dynamic';

/** XML 1.0에 넣을 수 없는 제어 문자 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 바로 이 글자들을 지우려는 식이다
const INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function xml(text: string): string {
  return text.replace(INVALID, '').replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

function item(post: PostSummary, site: string): string {
  const link = xml(`${site}${postPath(post.slug)}`);
  return [
    '    <item>',
    `      <title>${xml(post.title)}</title>`,
    `      <link>${link}</link>`,
    `      <guid isPermaLink="true">${link}</guid>`,
    post.publishedAt ? `      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>` : '',
    `      <description>${xml(post.excerpt)}</description>`,
    ...post.tags.map((t) => `      <category>${xml(t)}</category>`),
    '    </item>',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function GET(request: Request): Promise<Response> {
  const [space, list] = await Promise.all([
    serverGet<SpaceInfo>('/api/space', true),
    serverGet<PostList>('/api/posts', true),
  ]);
  if (!space || !list) return new Response('', { status: 503 });
  const site = (space.siteUrl ?? new URL(request.url).origin).replace(/\/+$/, '');
  const name = space.name || 'Cairn';
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xml(name)}</title>`,
    `    <link>${xml(site)}</link>`,
    `    <description>${xml(space.description || name)}</description>`,
    '    <language>ko</language>',
    `    <atom:link href="${xml(`${site}/rss.xml`)}" rel="self" type="application/rss+xml"/>`,
    ...list.posts.map((p) => item(p, site)),
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
  return new Response(body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
