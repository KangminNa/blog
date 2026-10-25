'use client';

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { postPath } from '../_blog/format';
import { api, describe } from '../_lib/client-api';
import { renderMarkdown } from '../_lib/markdown';
import { type EditablePost, POST_STATUS_LABELS, type PostStatus } from '../_lib/types';
import { useToast } from '../_ui/useToast';

/** 편집 중인 값 (화면의 칸 그대로) */
type Draft = { title: string; body: string; tags: string; slug: string; align: 'left' | 'center' };

/** 본문의 고른 부분과 바꾼 결과 */
type Edit = { value: string; start: number; end: number };

const STATUSES: readonly PostStatus[] = ['draft', 'published', 'unlisted'];

const STATUS_DONE: Record<PostStatus, string> = {
  draft: '임시 글로 돌렸어요',
  published: '글을 공개했어요',
  unlisted: '링크만 공개로 바꿨어요',
};

function draftOf(post: EditablePost | null): Draft {
  return post
    ? {
        title: post.title,
        body: post.body,
        tags: post.tags.join(', '),
        slug: post.slug,
        align: post.align,
      }
    : { title: '', body: '', tags: '', slug: '', align: 'left' };
}

function tagsOf(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim().replace(/^#+/, '').trim())
    .filter((t) => t.length > 0);
}

/** 고른 글자를 앞뒤 표시로 감싼다 (없으면 예시 글자를 넣고 고른다) */
function wrap(mark: string, example: string) {
  return (v: string, s: number, e: number): Edit => {
    const inner = v.slice(s, e) || example;
    return {
      value: `${v.slice(0, s)}${mark}${inner}${mark}${v.slice(e)}`,
      start: s + mark.length,
      end: s + mark.length + inner.length,
    };
  };
}

/** 고른 줄마다 앞에 붙인다 (제목·목록·인용) */
function prefix(head: string) {
  return (v: string, s: number, e: number): Edit => {
    const from = v.lastIndexOf('\n', s - 1) + 1;
    const lines = v.slice(from, e).split('\n');
    const text = lines.map((l) => `${head}${l.replace(/^(#{1,6} |> |- )/, '')}`).join('\n');
    return {
      value: `${v.slice(0, from)}${text}${v.slice(e)}`,
      start: from,
      end: from + text.length,
    };
  };
}

/** 블록 하나를 제 줄에 넣는다 (가운데·큰 인용·구분선·코드) */
function block(before: string, after: string, example: string) {
  return (v: string, s: number, e: number): Edit => {
    const inner = v.slice(s, e) || example;
    const lead = s === 0 || v[s - 1] === '\n' ? '' : '\n';
    const text = `${lead}${before}${inner}${after}`;
    const start = s + lead.length + before.length;
    return { value: `${v.slice(0, s)}${text}${v.slice(e)}`, start, end: start + inner.length };
  };
}

const TOOLS: readonly [string, string, (v: string, s: number, e: number) => Edit][] = [
  ['제목', '큰 제목 (##)', prefix('## ')],
  ['소제목', '작은 제목 (###)', prefix('### ')],
  ['굵게', '굵게 (**)', wrap('**', '굵은 글자')],
  ['기울임', '기울임 (_)', wrap('_', '기울인 글자')],
  [
    '링크',
    '링크',
    (v, s, e) => {
      const label = v.slice(s, e) || '글자';
      const text = `[${label}](https://)`;
      return {
        value: `${v.slice(0, s)}${text}${v.slice(e)}`,
        start: s + label.length + 3,
        end: s + text.length - 1,
      };
    },
  ],
  ['목록', '목록 (-)', prefix('- ')],
  ['인용', '인용 (>)', prefix('> ')],
  ['큰 인용', '큰 인용 (> [!quote])', block('> [!quote]\n> ', '\n', '인용할 문장')],
  [
    '가운데',
    '가운데 정렬 블록 (::: center)',
    block('::: center\n', '\n:::\n', '가운데로 보일 문단'),
  ],
  ['구분선', '구분선 (---)', block('\n---\n', '', '')],
  ['코드', '코드 블록 (```)', block('```\n', '\n```\n', '코드')],
];

// 글 편집기. 왼쪽에 쓰고 오른쪽에서 방문자가 볼 모양을 바로 본다 (좁은 화면은 쓰기·미리 보기 탭).
// 저장할 때마다 제목·본문이 바뀌었으면 새 판이 쌓인다. 공개 범위는 저장한 뒤에 바꾼다.
// 다른 탭에서 먼저 고쳤으면 서버가 409로 막고, 덮어쓰지 않고 다시 불러오라고 알린다.
export function PostEditor({ initial }: { initial: EditablePost | null }) {
  const [post, setPost] = useState(initial);
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [toast, showToast] = useToast();
  const requestId = useRef<string>('');
  const area = useRef<HTMLTextAreaElement>(null);
  /** 도구 막대가 바꾼 뒤 고를 자리. React가 본문을 그린 뒤에 고른다 (먼저 고르면 그리면서 풀린다) */
  const pendingSelection = useRef<readonly [number, number] | null>(null);
  const body = useDeferredValue(draft.body);
  const html = useMemo(() => renderMarkdown(body), [body]);

  if (!requestId.current) requestId.current = crypto.randomUUID();

  const slugChanged = post !== null && draft.slug.trim() !== '' && draft.slug.trim() !== post.slug;
  const dirty = post
    ? draft.title.trim() !== post.title ||
      draft.body !== post.body ||
      tagsOf(draft.tags).join('\n') !== post.tags.join('\n') ||
      draft.align !== post.align ||
      slugChanged
    : draft.title.trim() !== '' || draft.body !== '';

  const save = useCallback(async (): Promise<EditablePost | null> => {
    if (!draft.title.trim()) {
      setError('제목을 적어 주세요');
      return null;
    }
    setBusy(true);
    setError(null);
    const fields = {
      title: draft.title,
      body: draft.body,
      tags: tagsOf(draft.tags),
      align: draft.align,
    };
    const reply = post
      ? await api<EditablePost>('PUT', `/api/posts/${post.id}`, {
          ...fields,
          version: post.version,
          slug: slugChanged ? draft.slug.trim() : null,
        })
      : await api<EditablePost>('POST', '/api/posts', {
          ...fields,
          requestId: requestId.current,
          slug: draft.slug.trim() || null,
        });
    setBusy(false);
    if (!reply.ok) {
      setConflict(reply.status === 409);
      setError(describe(reply.error));
      return null;
    }
    const saved = reply.data;
    if (!post) window.history.replaceState(null, '', `/admin/posts/${saved.id}`);
    setPost(saved);
    setDraft((d) => ({ ...d, slug: saved.slug }));
    showToast(saved.revised ? `저장했어요 · ${saved.revisionCount}판` : '바뀐 내용이 없어요');
    return saved;
  }, [draft, post, slugChanged, showToast]);

  async function changeStatus(next: PostStatus) {
    const current = !post || dirty ? await save() : post;
    if (!current || current.status === next) return;
    setBusy(true);
    const reply = await api<EditablePost>('POST', `/api/posts/${current.id}/status`, {
      version: current.version,
      status: next,
    });
    setBusy(false);
    if (!reply.ok) {
      setConflict(reply.status === 409);
      return setError(describe(reply.error));
    }
    setPost(reply.data);
    showToast(STATUS_DONE[next]);
  }

  async function trash() {
    if (!post) return;
    if (!window.confirm('휴지통으로 옮길까요? 30일 동안 되살릴 수 있어요')) return;
    const reply = await api('DELETE', `/api/posts/${post.id}`, { version: post.version });
    if (!reply.ok) return setError(describe(reply.error));
    window.location.href = '/?sheet=posts';
  }

  async function recover() {
    if (!post) return;
    const reply = await api<EditablePost>('POST', `/api/posts/${post.id}/restore`, {
      version: post.version,
    });
    if (!reply.ok) return setError(describe(reply.error));
    setPost(reply.data);
    showToast('되살렸어요');
  }

  function apply(tool: (v: string, s: number, e: number) => Edit) {
    const el = area.current;
    if (!el) return;
    const next = tool(draft.body, el.selectionStart, el.selectionEnd);
    pendingSelection.current = [next.start, next.end];
    setDraft((d) => ({ ...d, body: next.value }));
  }

  useLayoutEffect(() => {
    const el = area.current;
    const range = pendingSelection.current;
    if (!el || !range || el.value !== draft.body) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  }, [draft.body]);

  // ⌘S · Ctrl+S로 저장, 저장 안 한 채 떠나려 하면 묻는다
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!busy) void save();
      }
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('beforeunload', leave);
    };
  }, [busy, dirty, save]);

  const trashed = post?.deletedAt != null;
  const state = !post
    ? '새 글 · 아직 저장 안 함'
    : dirty
      ? '저장 안 한 변경 있음'
      : `저장됨 · ${post.revisionCount}판`;

  return (
    <div className="editor">
      <header className="editor-top">
        <a className="ghost" href="/?sheet=posts">
          ← 글 목록
        </a>
        <span className="editor-state" aria-live="polite">
          {state}
        </span>
        <div className="editor-actions">
          <fieldset className="segment" disabled={busy || trashed}>
            <legend className="sr">공개 범위</legend>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={(post?.status ?? 'draft') === s}
                onClick={() => changeStatus(s)}
              >
                {POST_STATUS_LABELS[s]}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            className="cta small"
            disabled={busy || trashed}
            onClick={() => void save()}
          >
            {busy ? '저장 중' : '저장'}
          </button>
        </div>
      </header>

      {error && (
        <p className="error editor-error" role="alert">
          {error}
          {conflict && (
            <button type="button" className="ghost" onClick={() => window.location.reload()}>
              다시 불러오기
            </button>
          )}
        </p>
      )}
      {trashed && (
        <p className="warn editor-error">
          휴지통에 있는 글이에요. 되살린 뒤 고칠 수 있어요
          <button type="button" className="ghost" onClick={recover}>
            되살리기
          </button>
        </p>
      )}

      <div className="segment editor-tabs" role="tablist" aria-label="보기">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'write'}
          onClick={() => setView('write')}
        >
          쓰기
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'preview'}
          onClick={() => setView('preview')}
        >
          미리 보기
        </button>
      </div>

      <div className="editor-grid" data-view={view}>
        <section className="editor-form" aria-label="쓰기">
          <input
            className="editor-title"
            value={draft.title}
            maxLength={200}
            placeholder="제목"
            aria-label="제목"
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <div className="editor-meta">
            <label>
              <span>주소</span>
              <input
                className="input"
                value={draft.slug}
                maxLength={80}
                placeholder="제목에서 자동"
                onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
              />
            </label>
            <label>
              <span>태그</span>
              <input
                className="input"
                value={draft.tags}
                placeholder="쉼표로 나눠요"
                onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
              />
            </label>
            <div className="editor-align">
              <span>가운데 정렬</span>
              <button
                type="button"
                className="switch"
                role="switch"
                aria-checked={draft.align === 'center'}
                aria-label="글 전체 가운데 정렬"
                onClick={() =>
                  setDraft((d) => ({ ...d, align: d.align === 'center' ? 'left' : 'center' }))
                }
              />
            </div>
          </div>
          {slugChanged && post?.status !== 'draft' && (
            <small className="editor-hint">
              공개한 글의 주소를 바꾸면 예전 주소로 들어온 사람은 글을 못 찾아요
            </small>
          )}
          <div className="toolbar" role="toolbar" aria-label="본문 도구">
            {TOOLS.map(([label, title, tool]) => (
              <button key={label} type="button" title={title} onClick={() => apply(tool)}>
                {label}
              </button>
            ))}
          </div>
          <textarea
            ref={area}
            className="editor-body"
            value={draft.body}
            placeholder="본문 (md). 도구 막대로 가운데 정렬·큰 인용 등을 넣어요"
            aria-label="본문"
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          />
        </section>

        <section className="editor-preview blog" aria-label="미리 보기">
          <article className="post">
            <header className="post-head">
              <h1>{draft.title || '제목'}</h1>
            </header>
            <div
              className={`prose${draft.align === 'center' ? ' center' : ''}`}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: _lib/markdown.ts가 본문의 HTML을 그리지 않고 결과를 거른다
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>
        </section>
      </div>

      <footer className="editor-foot">
        {post && post.status !== 'draft' && !trashed && (
          <a className="ghost" href={postPath(post.slug)} target="_blank" rel="noopener">
            글 보기 ↗
          </a>
        )}
        {post && !post.deletedAt && (
          <button type="button" className="ghost danger" onClick={trash}>
            휴지통으로
          </button>
        )}
      </footer>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
