import type { ReactNode } from 'react';
import '../_blog/blog.css';
import type { Owner, SpaceInfo } from '../_account/types';
import { BlogHeader } from '../_blog/BlogHeader';
import type { PublicPageList } from '../_blog/types';
import { serverGet } from '../_lib/server-api';

// 구독기가 블로그 주소만으로 RSS를 찾게 한다
export const metadata = { alternates: { types: { 'application/rss+xml': '/rss.xml' } } };

// 공개 화면의 틀. 글 목록과 글 페이지가 같은 머리를 쓴다.
export default async function BlogLayout({ children }: { children: ReactNode }) {
  const [space, owner, pages] = await Promise.all([
    serverGet<SpaceInfo>('/api/space', true),
    serverGet<Owner>('/api/auth/me'),
    serverGet<PublicPageList>('/api/pages', true),
  ]);
  return (
    <div className="blog">
      <BlogHeader
        name={space?.name ?? ''}
        logoUrl={space?.logoUrl ?? null}
        owner={owner !== null}
        pages={(pages?.pages.length ?? 0) > 0}
      />
      {children}
    </div>
  );
}
