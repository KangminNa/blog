'use client';

import { useNotify } from '../../_ui/notify';
import { PostsPanel } from './PostsPanel';

export default function PostsPage() {
  const notify = useNotify();
  return (
    <section className="console-inner" aria-label="글">
      <header className="page-head">
        <h1>글</h1>
      </header>
      <PostsPanel onMessage={notify} />
    </section>
  );
}
