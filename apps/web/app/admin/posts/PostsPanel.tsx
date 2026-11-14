'use client';

import { useRef, useState } from 'react';
import { POST_STATUS_LABELS } from '../../_blog/labels';
import type { AdminPostList, AdminPostSummary, PostCounts } from '../../_blog/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { readPages } from '../../_task/live';

type Filter = 'all' | 'draft' | 'published' | 'unlisted' | 'trash';

const POST_TOPICS = ['blog.post.*'];

const TABS: readonly [Filter, string][] = [
  ['all', '전체'],
  ['draft', '초안'],
  ['published', '공개'],
  ['unlisted', '링크 공개'],
  ['trash', '휴지통'],
];

function countOf(counts: PostCounts | undefined, tab: Filter): number | null {
  if (!counts) return null;
  return tab === 'all' ? counts.draft + counts.published + counts.unlisted : counts[tab];
}

function mergePages(before: AdminPostList, more: AdminPostList): AdminPostList {
  return { ...more, posts: [...before.posts, ...more.posts] };
}

// 글: 공개 범위별 글 목록, 새 글, 휴지통에서 되살리기. 글을 누르면 편집기(/admin/posts/[id])로.
export function PostsPanel({ onMessage }: { onMessage: (text: string) => void }) {
  const [tab, setTab] = useState<Filter>('all');
  /** 읽어 둔 쪽 수. "더 보기"로 늘고 탭을 바꾸면 첫 쪽부터 */
  const pages = useRef(1);
  const path = tab === 'all' ? '/api/posts' : `/api/posts?status=${tab}`;
  const posts = useLiveValue(
    `posts:${tab}`,
    () => readPages(path, pages.current, mergePages),
    POST_TOPICS,
  );
  const action = useAction();
  const list = posts.data;
  const problem = action.problem ?? posts.error;
  // 탭을 바꿔 다시 읽는 동안에도 앞에 읽은 글 수를 보여 준다
  const [counts, setCounts] = useState<PostCounts>();
  if (list && list.counts !== counts) setCounts(list.counts);

  async function restore(post: AdminPostSummary) {
    const reply = await action.run(
      post.id,
      () => api('POST', `/api/posts/${post.id}/restore`, { version: post.version }),
      { reload: posts.reload },
    );
    if (reply?.ok) onMessage(`${post.title}을(를) 복원했어요`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" role="tablist" aria-label="공개 범위">
          {TABS.map(([id, label]) => {
            const n = countOf(counts, id);
            return (
              <button
                key={id}
                type="button"
                role="tab"
                className="chip"
                aria-selected={tab === id}
                onClick={() => {
                  pages.current = 1;
                  action.clear();
                  setTab(id);
                }}
              >
                {label}
                {n === null ? '' : ` ${n}`}
              </button>
            );
          })}
        </div>
        <a className="ghost" href="/admin/posts/new">
          + 새 글
        </a>
      </div>
      {problem && <p className="error">{problem}</p>}
      {list === null ? (
        <p className="label-mono">불러오는 중…</p>
      ) : list.posts.length === 0 ? (
        <p className="label-mono">{tab === 'trash' ? '휴지통이 비었어요' : '글 없음'}</p>
      ) : (
        <ul className="list">
          {list.posts.map((p) => (
            <li key={p.id} className="post-row">
              <a className="list-row" href={`/admin/posts/${p.id}`}>
                <b>{p.title}</b>
                <small>
                  {p.deletedAt ? '휴지통' : POST_STATUS_LABELS[p.status]} · 버전 {p.revisionCount} ·{' '}
                  {new Date(p.updatedAt).toLocaleString('ko-KR')}
                </small>
              </a>
              {p.deletedAt && (
                <button type="button" className="ghost" onClick={() => restore(p)}>
                  복원
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list?.next && (
        <button
          type="button"
          className="ghost wide"
          onClick={() => {
            pages.current += 1;
            void posts.reload();
          }}
        >
          더 보기
        </button>
      )}
    </div>
  );
}
