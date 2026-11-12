'use client';

import '../../_blog/blog.css';
import '../../_vault/vault.css';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { renderMarkdown } from '../../_lib/markdown';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { readPages } from '../../_task/live';
import { useNotify } from '../../_ui/notify';
import { useGraph } from '../../_vault/live';
import type {
  CategoryList,
  TrashedWiki,
  WikiDetail,
  WikiPage,
  WikiScoreBoard,
  WikiScoreDetail,
  WikiScoreItem,
  WikiTrash,
} from '../../_vault/types';

const WIKI_TOPICS = ['vault.wiki.saved', 'vault.change.*', 'vault.category.changed'];
/** 점수는 세션 · 글의 쓰임으로도 바뀐다 */
const SCORE_TOPICS = [...WIKI_TOPICS, 'vault.session.*', 'blog.post.*'];
const SCORE_VIEW = 'score';
const STALE_VIEW = 'stale';
const TRASH_VIEW = 'trash';
/** 목록 보기: 최근(기본) · 점수순 · 지울 만한(알림이 여는 곳) · 휴지통 */
const VIEWS: readonly (readonly [string | null, string])[] = [
  [null, '최근'],
  [SCORE_VIEW, '점수순'],
  [STALE_VIEW, '지울 만한'],
  [TRASH_VIEW, '휴지통'],
];
/** 물려받는 비율 β의 뜻 */
const RATIO_LABELS: Record<number, string> = { 1: '대체', 0.5: '근거', 0: '히스토리' };
const NO_CATEGORY = '';
const VISIBILITY_LABELS: Record<string, string> = { private: '비공개', public: '공개' };
const ORIGIN_LABELS: Record<string, string> = { ai: 'AI', human: '사람' };

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { dateStyle: 'short' });
const fixed = (n: number) => n.toFixed(2);

/** 목록 보기를 지키는 위키 주소 */
function hrefOf(view: string | null, wiki: string | null): string {
  const params = new URLSearchParams();
  if (view) params.set('view', view);
  if (wiki) params.set('wiki', wiki);
  const query = params.toString();
  return query ? `/admin/wiki?${query}` : '/admin/wiki';
}

function mergePages(before: WikiPage, more: WikiPage): WikiPage {
  return { ...more, wikis: [...before.wikis, ...more.wikis] };
}

// 위키: 왼쪽 목록(최근 · 점수순 · 휴지통)과 찾기 + 오른쪽 읽기·고치기. 좁은 화면에서는 고르기 전에 목록, 고른 뒤에 내용만 보인다.
export function WikiPanel({ openId, view }: { openId: string | null; view: string | null }) {
  const listView = VIEWS.some(([key]) => key !== null && key === view) ? view : null;
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
        <nav className="chips" aria-label="위키 목록 보기">
          {VIEWS.map(([key, label]) => (
            <Link
              key={label}
              className="chip"
              href={hrefOf(key, null)}
              aria-current={listView === key ? 'true' : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        {listView === SCORE_VIEW ? (
          <ScoreList openId={openId} />
        ) : listView === STALE_VIEW ? (
          <StaleList openId={openId} />
        ) : listView === TRASH_VIEW ? (
          <TrashList />
        ) : (
          <>
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
                      href={hrefOf(null, w.id)}
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
          </>
        )}
      </div>
      <div className="split-detail">
        {openId && (
          <Link className="ghost split-back" href={hrefOf(listView, null)}>
            위키 목록
          </Link>
        )}
        {openId ? (
          <WikiView
            key={openId}
            id={openId}
            categories={categories.data}
            nameOf={nameOf}
            back={hrefOf(listView, null)}
          />
        ) : (
          <p className="rows-empty">위키를 골라 주세요</p>
        )}
      </div>
    </div>
  );
}

/** 위키 하나: 읽기와 출처 세션, 점수와 대체. 고치기를 누르면 전체 본문을 고친다 */
function WikiView({
  id,
  categories,
  nameOf,
  back,
}: {
  id: string;
  categories: CategoryList | null;
  nameOf: (id: string | null) => string;
  /** 휴지통으로 보낸 뒤 돌아갈 목록 */
  back: string;
}) {
  const notify = useNotify();
  const router = useRouter();
  const wiki = useLiveValue(
    `wiki:${id}`,
    () => api<WikiDetail>('GET', `/api/wikis/${id}`),
    WIKI_TOPICS,
  );
  const graph = useGraph();
  const action = useAction();
  const save = useAction();
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

  async function trash(version: number) {
    if (!window.confirm('휴지통으로 보낼까요? 휴지통에서 되살릴 수 있어요')) return;
    const send = () => api('POST', `/api/wikis/${id}/trash`, { version });
    const reply = await action.run('trash', send, { done: '휴지통으로 보냈어요' });
    if (reply?.ok) router.push(back);
    else if (reply) notify(describe(reply.error));
  }

  // 저장은 여기서 돌린다 (폼은 칸만)
  async function submit(body: WikiBody) {
    const plan = { done: '위키를 저장했어요', reload: wiki.reload };
    const reply = await save.run('save', () => api('PUT', `/api/wikis/${id}`, body), plan);
    if (reply?.ok) setEditing(false);
  }

  if (editing)
    return (
      <WikiEdit
        wiki={w}
        categories={categories}
        busy={save.busy !== null}
        problem={save.problem}
        onSubmit={submit}
        cancel={() => {
          save.clear();
          setEditing(false);
        }}
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
        <div className="row">
          <button type="button" className="ghost" onClick={() => setEditing(true)}>
            고치기
          </button>
          <button type="button" className="ghost" onClick={() => trash(w.version)}>
            휴지통으로
          </button>
        </div>
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
      <ScoreBox id={id} />
      <ReplaceBox id={id} />
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

/** 점수순 목록: 카테고리별 순위, 미분류는 끝. 가장 높은 위키가 100 */
function ScoreList({ openId }: { openId: string | null }) {
  const board = useLiveValue(
    'wiki-scores',
    () => api<WikiScoreBoard>('GET', '/api/wiki-scores'),
    SCORE_TOPICS,
  );
  if (board.error) return <p className="error">{board.error}</p>;
  if (board.data === null) return <p className="label-mono">불러오는 중…</p>;
  if (board.data.groups.length === 0) return <p className="rows-empty">위키 없음</p>;
  return (
    <>
      <p className="note">
        쓰일수록 오르고, 쓰이지 않으면 {board.data.halfLifeDays}일마다 반으로 줄어요
      </p>
      {board.data.groups.map((g) => (
        <section key={g.categoryId ?? 'none'} className="stack" aria-label={g.name ?? '미분류'}>
          <div className="kind">{g.name ?? '미분류'}</div>
          <ul className="list">
            {g.wikis.map((w) => (
              <ScoreRow key={w.id} wiki={w} openId={openId} />
            ))}
          </ul>
        </section>
      ))}
      {board.data.history.length > 0 && (
        <section className="stack" aria-label="히스토리">
          <div className="kind">히스토리 (대체된 위키, 순위 밖)</div>
          <ul className="list">
            {board.data.history.map((w) => (
              <ScoreRow key={w.id} wiki={w} openId={openId} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ScoreRow({
  wiki,
  openId,
  view = SCORE_VIEW,
}: {
  wiki: WikiScoreItem;
  openId: string | null;
  /** 누르면 이 목록 보기를 지킨 채 연다 */
  view?: string;
}) {
  return (
    <li>
      <Link
        className="item"
        href={hrefOf(view, wiki.id)}
        aria-current={wiki.id === openId ? 'true' : undefined}
      >
        <div className="item-main">
          <b>{wiki.title}</b>
          <small>
            쌓인 {fixed(wiki.accumulated)} · 물려받은 {fixed(wiki.inherited)} · 마지막 쓰임{' '}
            {day(wiki.lastUsedAt)}
            {wiki.stale ? ' · 지울 만한' : ''}
          </small>
        </div>
        {/* 히스토리는 순위 밖이라 100점 환산 값을 보이지 않는다 */}
        <span className="pill" title={`최종 점수 ${fixed(wiki.total)}`}>
          {wiki.replacedBy ? '히스토리' : wiki.score}
        </span>
      </Link>
    </li>
  );
}

/** 위키 하나의 점수: 최종 = 쌓인 + 물려받은, 물려받은 곳 */
function ScoreBox({ id }: { id: string }) {
  const score = useLiveValue(
    `wiki-score:${id}`,
    () => api<WikiScoreDetail>('GET', `/api/wiki-scores/${id}`),
    SCORE_TOPICS,
  );
  const s = score.data;
  if (!s) return null;
  return (
    <div>
      <div className="kind">점수</div>
      <dl className="kv">
        <dt>환산</dt>
        <dd>{s.wiki.score} / 100</dd>
        <dt>최종</dt>
        <dd className="mono">
          {fixed(s.wiki.total)} = 쌓인 {fixed(s.wiki.accumulated)} + 물려받은{' '}
          {fixed(s.wiki.inherited)}
        </dd>
        <dt>쓰임</dt>
        <dd>
          {s.wiki.uses}번 · 마지막 {day(s.wiki.lastUsedAt)}
        </dd>
      </dl>
      {s.bases.length > 0 && <div className="kind">근거로 삼은 위키</div>}
      {s.bases.length > 0 && (
        <div className="linked">
          {s.bases.map((b) => (
            <Link key={b.wikiId} href={hrefOf(null, b.wikiId)}>
              {b.title} · {RATIO_LABELS[b.ratio] ?? `β ${b.ratio}`} +{fixed(b.amount)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** 지울 만한 위키: 점수가 기준 아래이고 공개 · 글이 가리키는 위키 · 히스토리가 아닌 것. 지우는 것은 주인이다 */
function StaleList({ openId }: { openId: string | null }) {
  const board = useLiveValue(
    'wiki-scores',
    () => api<WikiScoreBoard>('GET', '/api/wiki-scores'),
    SCORE_TOPICS,
  );
  if (board.error) return <p className="error">{board.error}</p>;
  if (board.data === null) return <p className="label-mono">불러오는 중…</p>;
  const stale = board.data.groups
    .flatMap((g) => g.wikis)
    .filter((w) => w.stale)
    .sort((a, b) => a.total - b.total);
  return (
    <>
      <p className="note">
        오래 쓰이지 않은 위키예요 (최종 점수 {board.data.staleBelow} 아래). 공개 위키 · 글이
        가리키는 위키 · 히스토리는 빼요. 저절로 지우지 않아요: 열어서 휴지통으로 보내면 되살릴 수
        있어요
      </p>
      {stale.length === 0 ? (
        <p className="rows-empty">지울 만한 위키 없음</p>
      ) : (
        <ul className="list" aria-label="지울 만한 위키">
          {stale.map((w) => (
            <ScoreRow key={w.id} wiki={w} openId={openId} view={STALE_VIEW} />
          ))}
        </ul>
      )}
    </>
  );
}

/** 휴지통: 지운 때가 늦은 순. 되살리면 판 · 연결 · 세션의 대표가 그대로 돌아온다 */
function TrashList() {
  const notify = useNotify();
  const action = useAction();
  const trash = useLiveValue(
    'wiki-trash',
    () => api<WikiTrash>('GET', '/api/wikis/trash'),
    WIKI_TOPICS,
  );

  async function restore(wiki: TrashedWiki) {
    const send = () => api('POST', `/api/wikis/${wiki.id}/restore`, { version: wiki.version });
    const plan = { done: `${wiki.title} 되살림`, reload: trash.reload };
    const reply = await action.run(wiki.id, send, plan);
    if (reply && !reply.ok) notify(describe(reply.error));
  }

  if (trash.error) return <p className="error">{trash.error}</p>;
  if (trash.data === null) return <p className="label-mono">불러오는 중…</p>;
  if (trash.data.wikis.length === 0) return <p className="rows-empty">휴지통 비어 있음</p>;
  return (
    <>
      <p className="note">되살리면 판 · 연결 · 세션의 대표가 그대로 돌아와요</p>
      <ul className="list" aria-label="휴지통">
        {trash.data.wikis.map((w) => (
          <li key={w.id} className="item">
            <div className="item-main">
              <b>{w.title}</b>
              <small>지운 때 {w.deletedAt ? when(w.deletedAt) : '-'}</small>
            </div>
            <button type="button" className="ghost" onClick={() => restore(w)}>
              되살리기
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** 대체: 이 위키가 결론을 뒤집은 옛 위키(옛 위키는 히스토리), 이 위키를 대체한 위키 */
function ReplaceBox({ id }: { id: string }) {
  const notify = useNotify();
  const score = useLiveValue(
    `wiki-score:${id}`,
    () => api<WikiScoreDetail>('GET', `/api/wiki-scores/${id}`),
    SCORE_TOPICS,
  );
  const board = useLiveValue(
    'wiki-scores',
    () => api<WikiScoreBoard>('GET', '/api/wiki-scores'),
    SCORE_TOPICS,
  );
  const action = useAction();
  const [oldId, setOldId] = useState('');
  const reload = () => Promise.all([score.reload(), board.reload()]);
  const s = score.data;
  if (!s) return null;
  const all = [
    ...(board.data?.groups ?? []).flatMap((g) => g.wikis),
    ...(board.data?.history ?? []),
  ];
  const titleOf = (wikiId: string) => all.find((w) => w.id === wikiId)?.title ?? '위키';
  const replaced = s.bases.filter((b) => b.ratio === 1);
  const candidates = (board.data?.groups ?? [])
    .flatMap((g) => g.wikis)
    .filter((w) => w.id !== id && !replaced.some((r) => r.wikiId === w.id));

  async function replace(e: FormEvent) {
    e.preventDefault();
    const send = () => api('POST', `/api/wikis/${id}/replaces`, { oldId });
    const reply = await action.run('replace', send, { done: '대체로 표시했어요', reload });
    if (reply?.ok) setOldId('');
    else if (reply) notify(describe(reply.error));
  }

  async function release(old: string) {
    const send = () => api('DELETE', `/api/wikis/${id}/replaces/${old}`);
    const reply = await action.run(old, send, { done: '대체 표시를 지웠어요', reload });
    if (reply && !reply.ok) notify(describe(reply.error));
  }

  return (
    <div className="stack">
      <div className="kind">대체</div>
      {s.wiki.replacedBy && (
        <p className="note">
          히스토리라 근거로 쓰지 않아요. 대체한 위키:{' '}
          <Link href={hrefOf(null, s.wiki.replacedBy)}>{titleOf(s.wiki.replacedBy)}</Link>
        </p>
      )}
      {replaced.map((r) => (
        <div key={r.wikiId} className="row">
          <Link href={hrefOf(null, r.wikiId)}>{r.title}</Link>
          <span className="note">대체함</span>
          <button type="button" className="ghost" onClick={() => release(r.wikiId)}>
            대체 해제
          </button>
        </div>
      ))}
      <form className="row" onSubmit={replace} aria-label="대체로 표시">
        <label className="sr" htmlFor={`replace-${id}`}>
          결론을 뒤집은 옛 위키
        </label>
        <select
          id={`replace-${id}`}
          className="input"
          value={oldId}
          onChange={(e) => setOldId(e.target.value)}
        >
          <option value="">결론을 뒤집은 옛 위키</option>
          {candidates.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </select>
        <button type="submit" className="ghost" disabled={action.busy === 'replace' || !oldId}>
          대체로 표시
        </button>
      </form>
    </div>
  );
}

/** 저장할 때 보내는 본문 (PUT /api/wikis/:id). 본 version을 함께 보낸다 */
type WikiBody = Pick<WikiDetail, 'version' | 'title' | 'bodyMd' | 'categoryId' | 'visibility'>;

/** 위키 고치기 폼: 칸의 상태와 보낼 본문만 가진다. 저장은 WikiView가 돌린다 (onSubmit) */
function WikiEdit({
  wiki,
  categories,
  busy,
  problem,
  onSubmit,
  cancel,
}: {
  wiki: WikiDetail;
  categories: CategoryList | null;
  busy: boolean;
  problem: string | null;
  onSubmit: (body: WikiBody) => void;
  cancel: () => void;
}) {
  const [title, setTitle] = useState(wiki.title);
  const [body, setBody] = useState(wiki.bodyMd);
  const [category, setCategory] = useState(wiki.categoryId ?? NO_CATEGORY);
  const [visibility, setVisibility] = useState(wiki.visibility);

  function submit(e: FormEvent) {
    e.preventDefault();
    const categoryId = category === NO_CATEGORY ? null : category;
    onSubmit({ version: wiki.version, title, bodyMd: body, categoryId, visibility });
  }

  return (
    <form className="panel wiki-edit" aria-label={`${wiki.title} 고치기`} onSubmit={submit}>
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
      {problem && <p className="error">{problem}</p>}
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
