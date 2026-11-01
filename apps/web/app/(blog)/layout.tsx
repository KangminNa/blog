import type { ReactNode } from 'react';
import '../_blog/blog.css';
import { BlogHeader } from '../_blog/BlogHeader';
import { serverGet } from '../_lib/server-api';
import type { Owner, SpaceInfo } from '../_lib/types';

// 구독기가 블로그 주소만으로 RSS를 찾게 한다
export const metadata = { alternates: { types: { 'application/rss+xml': '/rss.xml' } } };

// 공개 화면의 틀. 글 목록과 글 페이지가 같은 머리를 쓴다.
export default async function BlogLayout({ children }: { children: ReactNode }) {
  const [space, owner] = await Promise.all([
    serverGet<SpaceInfo>('/api/space', true),
    serverGet<Owner>('/api/auth/me'),
  ]);
  return (
    <div className="blog">
      <BlogHeader name={space?.name ?? ''} owner={owner !== null} />
      {children}
    </div>
  );
}
