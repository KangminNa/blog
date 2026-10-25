import { notFound, redirect } from 'next/navigation';
import '../../../_blog/blog.css';
import { PostEditor } from '../../../_admin/PostEditor';
import { serverGet } from '../../../_lib/server-api';
import type { EditablePost, Owner } from '../../../_lib/types';

// 글 편집기 (/admin/posts/new: 새 글, /admin/posts/<id>: 고쳐 쓰기). 주인만.
export const dynamic = 'force-dynamic';

export const metadata = { title: '글 쓰기 · Cairn', robots: { index: false } };

export default async function EditPost({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await serverGet<Owner>('/api/auth/me');
  if (!owner) redirect(`/login?return=${encodeURIComponent(`/admin/posts/${id}`)}`);
  if (id === 'new') return <PostEditor initial={null} />;
  const post = await serverGet<EditablePost>(`/api/posts/${encodeURIComponent(id)}`);
  if (!post) notFound();
  return <PostEditor initial={post} />;
}
