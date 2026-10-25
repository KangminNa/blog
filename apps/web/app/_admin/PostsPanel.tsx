'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, describe } from '../_lib/client-api';
import {
  type AdminPostSummary,
  POST_STATUS_LABELS,
  type PostCounts,
  type PostList,
} from '../_lib/types';

type Filter = 'all' | 'draft' | 'published' | 'unlisted' | 'trash';

const TABS: readonly [Filter, string][] = [
  ['all', '전체'],
  ['draft', '임시'],
  ['published', '공개'],
  ['unlisted', '링크만'],
  ['trash', '휴지통'],
];

function countOf(counts: PostCounts | undefined, tab: Filter): number | null {
  if (!counts) return null;
  return tab === 'all' ? counts.draft + counts.published + counts.unlisted : counts[tab];
}

// 글 시트: 공개 범위별 글 목록, 새 글, 휴지통에서 되살리기. 글을 누르면 편집기(/admin/posts/[id])로.
export function PostsPanel({ onMessage }: { onMessage: (text: string) => void }) {
  const [tab, setTab] = useState<Filter>('all');
  const [list, setList] = useState<PostList<AdminPostSummary> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (filter: Filter, cursor: string | null = null) => {
    const query = new URLSearchParams();
    if (filter !== 'all') query.set('status', filter);
    if (cursor) query.set('cursor', cursor);
    const reply = await api<PostList<AdminPostSummary>>('GET', `/api/posts?${query}`);
    if (!reply.ok) return setError(describe(reply.error));
    setError(null);
    setList((before) =>
      cursor && before
        ? { ...reply.data, posts: [...before.posts, ...reply.data.posts] }
        : reply.data,
    );
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  async function restore(post: AdminPostSummary) {
    const reply = await api('POST', `/api/posts/${post.id}/restore`, { version: post.version });
    if (!reply.ok) return setError(describe(reply.error));
    onMessage(`${post.title}을(를) 되살렸어요`);
    await load(tab);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" role="tablist" aria-label="공개 범위">
          {TABS.map(([id, label]) => {
            const n = countOf(list?.counts, id);
            return (
              <button
                key={id}
                type="button"
                role="tab"
                className="chip"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
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
      {error && <p className="error">{error}</p>}
      {list === null ? (
        <p className="label-mono">불러오는 중…</p>
      ) : list.posts.length === 0 ? (
        <p className="label-mono">{tab === 'trash' ? '휴지통이 비었어요' : '아직 글 없음'}</p>
      ) : (
        <ul className="list">
          {list.posts.map((p) => (
            <li key={p.id} className="post-row">
              <a className="list-row" href={`/admin/posts/${p.id}`}>
                <b>{p.title}</b>
                <small>
                  {p.deletedAt ? '휴지통' : POST_STATUS_LABELS[p.status]} · {p.revisionCount}판 ·{' '}
                  {new Date(p.updatedAt).toLocaleString('ko-KR')}
                </small>
              </a>
              {p.deletedAt && (
                <button type="button" className="ghost" onClick={() => restore(p)}>
                  되살리기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list?.next && (
        <button type="button" className="ghost wide" onClick={() => load(tab, list.next)}>
          더 보기
        </button>
      )}
    </div>
  );
}
