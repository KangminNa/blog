'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type {
  BasketItemView,
  BasketView,
} from '../../../../server/src/modules/blog/basket/basket.view';
import { api, describe } from '../../_lib/client-api';
import { useNotify } from '../AdminShell';

type Item = ReturnType<BasketItemView['toJSON']>;
type Basket = ReturnType<BasketView['toJSON']>;
type NewKind = 'link' | 'note';

const KIND_LABELS: Record<string, string> = {
  session: '세션',
  post: '글',
  link: '링크',
  note: '메모',
};

const NEW_KINDS: readonly [NewKind, string][] = [
  ['link', '링크'],
  ['note', '메모'],
];

/** 소재가 가리키는 곳. 메모는 없다 */
function hrefOf(item: Item): string | null {
  if (item.kind === 'link') return item.url;
  if (item.kind === 'session') return `/admin/sessions?session=${item.refId}`;
  if (item.kind === 'post') return `/admin/posts/${item.refId}`;
  return null;
}

function headOf(item: Item): string {
  return item.title || item.url || item.note || '제목 없음';
}

const NAMED_MAX = 30;
const NAME_MAX = 80;

/** 작업 지시: 소재의 이름만 적는다. 내용은 에이전트가 basket_get으로 읽는다 */
function draftInstruction(items: readonly Item[]): string {
  const names = items.slice(0, NAMED_MAX).map((item) => {
    const name = headOf(item).replace(/\s+/g, ' ').slice(0, NAME_MAX);
    return `- ${KIND_LABELS[item.kind] ?? item.kind}: ${name}`;
  });
  const rest = items.length - names.length;
  return [
    '아래 소재로 블로그 초안을 써 주세요.',
    ...names,
    ...(rest > 0 ? [`- 외 ${rest}개`] : []),
  ].join('\n');
}

/** 큰 줄 아래의 작은 줄. 큰 줄에 이미 쓴 내용은 되풀이하지 않는다 */
function detailOf(item: Item): string | null {
  const head = headOf(item);
  return [item.url, item.note].filter((t) => t && t !== head).join(' · ') || null;
}

// 소재: 글을 쓰려고 모아 둔 세션·글·링크·메모. 여기서는 링크와 메모를 담고, 지우고, 초안 작업을 맡긴다.
// 소재를 지워도 가리키던 세션·글은 그대로다.
export function BasketPanel() {
  const notify = useNotify();
  const [items, setItems] = useState<Item[] | null>(null);
  const [kind, setKind] = useState<NewKind>('link');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 응답을 못 받아 다시 눌러도 하나만 담기게, 담은 뒤에만 새 값으로 바꾼다 */
  const requestId = useRef('');
  if (!requestId.current) requestId.current = crypto.randomUUID();

  const load = useCallback(async () => {
    const reply = await api<Basket>('GET', '/api/basket/items');
    if (!reply.ok) return setError(describe(reply.error));
    setItems(reply.data.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const reply = await api<Item>('POST', '/api/basket/items', {
      requestId: requestId.current,
      kind,
      title: title.trim() || null,
      ...(kind === 'link' ? { url: url.trim() } : { note }),
    });
    setBusy(false);
    if (!reply.ok) return setError(describe(reply.error));
    requestId.current = crypto.randomUUID();
    setUrl('');
    setTitle('');
    setNote('');
    setItems((before) => [reply.data, ...(before ?? [])]);
    notify('소재에 추가했어요');
  }

  /** 누를 때마다 작업 하나. 담당은 정하지 않아 일을 받을 수 있는 에이전트가 맡는다 */
  async function draft(from: readonly Item[]) {
    setDrafting(true);
    setError(null);
    const reply = await api('POST', '/api/tasks', {
      requestId: crypto.randomUUID(),
      kind: 'draft_post',
      title: `소재 ${from.length}개로 초안 쓰기`,
      instruction: draftInstruction(from),
    });
    setDrafting(false);
    if (!reply.ok) return setError(describe(reply.error));
    notify('초안 작업을 만들었어요');
  }

  async function remove(item: Item) {
    if (!window.confirm(`삭제할까요? ${headOf(item)}`)) return;
    const reply = await api('DELETE', `/api/basket/items/${item.id}`);
    if (!reply.ok) return setError(describe(reply.error));
    setItems((before) => (before ?? []).filter((i) => i.id !== item.id));
    notify('삭제했어요');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <form className="basket-add" onSubmit={add}>
        <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sr">추가할 종류</legend>
          {NEW_KINDS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="chip"
              aria-pressed={kind === id}
              onClick={() => setKind(id)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        {kind === 'link' ? (
          <label className="field">
            <span>주소</span>
            <input
              className="input"
              type="url"
              inputMode="url"
              value={url}
              required
              maxLength={2000}
              placeholder="https://"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
        ) : (
          <label className="field">
            <span>메모</span>
            <textarea
              className="input"
              value={note}
              required
              maxLength={10000}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          <span>제목</span>
          <input
            className="input"
            value={title}
            maxLength={200}
            placeholder="비워도 돼요"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="cta small" disabled={busy}>
          {busy ? '추가 중' : '추가'}
        </button>
      </form>

      {items && items.length > 0 && (
        <div className="row">
          <button
            type="button"
            className="cta small"
            disabled={drafting}
            onClick={() => void draft(items)}
          >
            {drafting ? '만드는 중' : '이 소재로 초안 쓰기'}
          </button>
        </div>
      )}

      {items === null ? (
        !error && <p className="label-mono">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="label-mono">소재 없음</p>
      ) : (
        <ul className="list" aria-label="소재 목록">
          {items.map((item) => {
            const href = hrefOf(item);
            const detail = detailOf(item);
            return (
              <li key={item.id} className="basket-row">
                <span className="pill">{KIND_LABELS[item.kind] ?? item.kind}</span>
                <div className="basket-main">
                  {href ? (
                    <a
                      href={href}
                      {...(item.kind === 'link'
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      {headOf(item)}
                    </a>
                  ) : (
                    <b>{headOf(item)}</b>
                  )}
                  {detail && <small>{detail}</small>}
                </div>
                <button
                  type="button"
                  className="ghost"
                  aria-label={`삭제: ${headOf(item)}`}
                  onClick={() => void remove(item)}
                >
                  삭제
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
