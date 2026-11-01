'use client';

import '../../_blog/blog.css';
import '../../_vault/vault.css';
import Link from 'next/link';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { renderMarkdown } from '../../_lib/markdown';
import { useLiveValue } from '../../_lib/use-live';
import { readPages } from '../../_task/live';
import { useGraph } from '../../_vault/live';
import type { CategoryList, WikiDetail, WikiPage } from '../../_vault/types';
import { useNotify } from '../AdminShell';

const WIKI_TOPICS = ['vault.wiki.saved', 'vault.change.*', 'vault.category.changed'];
const NO_CATEGORY = '';
const VISIBILITY_LABELS: Record<string, string> = { private: '비공개', public: '공개' };
const ORIGIN_LABELS: Record<string, string> = { ai: 'AI', human: '사람' };

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

function mergePages(before: WikiPage, more: WikiPage): WikiPage {
  return { ...more, wikis: [...before.wikis, ...more.wikis] };
}

// 위키: 왼쪽 목록과 찾기 + 오른쪽 읽기·고치기. 좁은 화면에서는 고르기 전에 목록, 고른 뒤에 내용만 보인다.
export function WikiPanel({ openId }: { openId: string | null }) {
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const pages = useRef(1);
  const path = query ? `/api/wikis?q=${encodeURIComponent(query)}` : '/api/wikis';
  const list = useLiveValue(
    `wikis:${query}`,
    () => readPages(path, pages.current, mergePages),
    WIKI_TOPICS,
  );
  const categories = useLiveValue(
    'categories',
    () => api<CategoryList>('GET', '/api/categories'),
    WIKI_TOPICS,
  );
  const nameOf = (id: string | null) =>
    categories.data?.categories.find((c) => c.id === id)?.name ?? '미분류';

  function search(e: FormEvent) {
    e.preventDefault();
    pages.current = 1;
    setQuery(typed.trim());
  }

  return (
    <div className={openId ? 'split picked' : 'split'}>
      <div className="split-list">
        <form className="wiki-search" onSubmit={search}>
          <label className="sr" htmlFor="wiki-find">
            위키 찾기
          </label>
          <input
            id="wiki-find"
            className="input"
            type="search"
            placeholder="찾기"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="submit" className="ghost">
            찾기
          </button>
        </form>
        {list.error && <p className="error">{list.error}</p>}
        {list.data === null ? (
          !list.error && <p className="label-mono">불러오는 중…</p>
        ) : list.data.wikis.length === 0 ? (
          <p className="rows-empty">{query ? '찾은 위키 없음' : '위키 없음'}</p>
        ) : (
          <ul className="list">
            {list.data.wikis.map((w) => (
              <li key={w.id}>
                <Link
                  className="item"
                  href={`/admin/wiki?wiki=${w.id}`}
                  aria-current={w.id === openId ? 'true' : undefined}
                >
                  <div className="item-main">
                    <b>{w.title}</b>
                    <small>
                      {nameOf(w.categoryId)} · {ORIGIN_LABELS[w.origin] ?? w.origin}
                    </small>
                  </div>
                  {w.visibility === 'public' && <span className="pill">공개</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {list.data?.next && (
          <button
            type="button"
            className="ghost wide"
            onClick={() => {
              pages.current += 1;
              void list.reload();
            }}
          >
            더 보기
          </button>
        )}
      </div>
      <div className="split-detail">
        {openId && (
          <Link className="ghost split-back" href="/admin/wiki">
            위키 목록
          </Link>
        )}
        {openId ? (
          <WikiView key={openId} id={openId} categories={categories.data} nameOf={nameOf} />
        ) : (
          <p className="rows-empty">위키를 골라 주세요</p>
        )}
      </div>
    </div>
  );
}

/** 위키 하나: 읽기와 출처 세션. 고치기를 누르면 전체 본문을 고친다 */
function WikiView({
  id,
  categories,
  nameOf,
}: {
  id: string;
  categories: CategoryList | null;
  nameOf: (id: string | null) => string;
}) {
  const wiki = useLiveValue(
    `wiki:${id}`,
    () => api<WikiDetail>('GET', `/api/wikis/${id}`),
    WIKI_TOPICS,
  );
  const graph = useGraph();
  const [editing, setEditing] = useState(false);
  const sources = useMemo(() => {
    const nodes = graph.data?.nodes ?? [];
    const material = new Set(
      (graph.data?.edges ?? [])
        .filter((e) => e.kind === 'material' && e.dst === id)
        .map((e) => e.src),
    );
    return nodes.filter((n) => n.kind === 'session' && (n.parent === id || material.has(n.id)));
  }, [graph.data, id]);

  const w = wiki.data;
  if (!w)
    return wiki.status === 404 ? (
      <p className="rows-empty">찾을 수 없는 위키</p>
    ) : wiki.error ? (
      <p className="error">{wiki.error}</p>
    ) : (
      <p className="label-mono">불러오는 중…</p>
    );

  if (editing)
    return (
      <WikiEdit
        wiki={w}
        categories={categories}
        done={async () => {
          await wiki.reload();
          setEditing(false);
        }}
        cancel={() => setEditing(false)}
      />
    );

  return (
    <article className="panel" aria-label={w.title}>
      <div className="page-head">
        <div className="page-title">
          <span className="note">
            {nameOf(w.categoryId)} · {VISIBILITY_LABELS[w.visibility] ?? w.visibility}
          </span>
          <h2>{w.title}</h2>
        </div>
        <button type="button" className="ghost" onClick={() => setEditing(true)}>
          고치기
        </button>
      </div>
      {w.bodyMd ? (
        <div
          className="prose"
          // md → HTML은 본문의 HTML을 그리지 않고 결과를 한 번 더 거른다 (_lib/markdown.ts)
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 위에서 거른 HTML
          dangerouslySetInnerHTML={{ __html: renderMarkdown(w.bodyMd) }}
        />
      ) : (
        <p className="rows-empty">본문 없음</p>
      )}
      <dl className="kv">
        <dt>판</dt>
        <dd>{w.revisionCount}</dd>
        <dt>고친 때</dt>
        <dd>{when(w.updatedAt)}</dd>
        <dt>주소</dt>
        <dd className="mono">{w.slug}</dd>
      </dl>
      <div>
        <div className="kind">출처 세션</div>
        {sources.length === 0 ? (
          <p className="note">없음</p>
        ) : (
          <div className="linked">
            {sources.map((s) => (
              <Link key={s.id} href={`/admin/sessions?session=${s.id}`}>
                {s.label || '제목 없음'}
              </Link>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function WikiEdit({
  wiki,
  categories,
  done,
  cancel,
}: {
  wiki: WikiDetail;
  categories: CategoryList | null;
  done: () => Promise<void>;
  cancel: () => void;
}) {
  const notify = useNotify();
  const [title, setTitle] = useState(wiki.title);
  const [body, setBody] = useState(wiki.bodyMd);
  const [category, setCategory] = useState(wiki.categoryId ?? NO_CATEGORY);
  const [visibility, setVisibility] = useState(wiki.visibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const reply = await api('PUT', `/api/wikis/${wiki.id}`, {
      version: wiki.version,
      title,
      bodyMd: body,
      categoryId: category === NO_CATEGORY ? null : category,
      visibility,
    });
    setBusy(false);
    if (!reply.ok) return setError(describe(reply.error));
    notify('위키를 저장했어요');
    await done();
  }

  return (
    <form className="panel wiki-edit" aria-label={`${wiki.title} 고치기`} onSubmit={save}>
      <label className="field" htmlFor="wiki-title">
        <span>제목</span>
        <input
          id="wiki-title"
          className="input"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="field" htmlFor="wiki-category">
        <span>카테고리</span>
        <select
          id="wiki-category"
          className="input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value={NO_CATEGORY}>미분류</option>
          {categories?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor="wiki-visibility">
        <span>공개 범위</span>
        <select
          id="wiki-visibility"
          className="input"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor="wiki-body">
        <span>본문 (md)</span>
        <textarea
          id="wiki-body"
          className="input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy}>
          {busy ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="ghost" onClick={cancel}>
          취소
        </button>
      </div>
    </form>
  );
}
