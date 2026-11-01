'use client';

import './wiki-picker.css';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import type { WikiDetail, WikiPage, WikiSummary } from '../../_vault/types';

/** 한 번에 보여줄 찾은 결과 */
const HITS_MAX = 6;
const SEARCH_DELAY_MS = 200;
const MISSING = '찾을 수 없는 위키';
const UNREAD = '이름을 불러오지 못했어요';

/** 고른 wiki의 이름. null은 없거나 볼 수 없는 wiki, 빈 글자는 읽지 못한 wiki */
type Titles = Readonly<Record<string, string | null>>;

async function titleOf(id: string): Promise<readonly [string, string | null]> {
  const reply = await api<WikiDetail>('GET', `/api/wikis/${id}`);
  if (reply.ok) return [id, reply.data.title];
  return [id, reply.status === 404 ? null : ''];
}

// 글 설정의 위키 고르기: 찾아서 고르고, 고른 것은 "빼기"로 지운다. max가 1이면 새로 고른 것으로 바뀐다.
// 키보드: 찾기 칸에서 Enter는 첫 결과를 고르고 Esc는 찾던 말을 지운다. 결과와 빼기는 Tab으로 간다.
// 지워졌거나 볼 수 없게 된 wiki는 id 없이 "찾을 수 없는 위키"로 보여 주고 뺄 수 있게 둔다.
export function WikiPicker({
  label,
  picks,
  max,
  exclude = [],
  onChange,
}: {
  label: string;
  picks: readonly string[];
  max: number;
  /** 고를 수 없는 wiki (참고에서 대표) */
  exclude?: readonly (string | null)[];
  onChange: (ids: readonly string[]) => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [titles, setTitles] = useState<Titles>({});
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly WikiSummary[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const unknown = picks.filter((id) => !(id in titles));
    if (unknown.length === 0) return;
    let live = true;
    void Promise.all(unknown.map(titleOf)).then((found) => {
      if (live) setTitles((known) => ({ ...known, ...Object.fromEntries(found) }));
    });
    return () => {
      live = false;
    };
  }, [picks, titles]);

  useEffect(() => {
    const words = query.trim();
    if (!words) {
      setHits(null);
      setFailed(null);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const reply = await api<WikiPage>('GET', `/api/wikis?q=${encodeURIComponent(words)}`);
      if (!live) return;
      setHits(reply.ok ? reply.data.wikis : null);
      setFailed(reply.ok ? null : describe(reply.error));
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const shown = (hits ?? [])
    .filter((w) => !picks.includes(w.id) && !exclude.includes(w.id))
    .slice(0, HITS_MAX);
  const full = max > 1 && picks.length >= max;

  function pick(wiki: WikiSummary) {
    setTitles((known) => ({ ...known, [wiki.id]: wiki.title }));
    onChange(max === 1 ? [wiki.id] : [...picks, wiki.id]);
    setQuery('');
    input.current?.focus();
  }

  function remove(id: string) {
    onChange(picks.filter((p) => p !== id));
    input.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    const first = shown[0];
    if (e.key === 'Enter' && first) {
      e.preventDefault();
      pick(first);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
    }
  }

  return (
    <div className="field wiki-pick">
      <label htmlFor={inputId}>{label}</label>
      {picks.length > 0 && (
        <ul className="wiki-pick-list">
          {picks.map((id) => {
            const title = titles[id];
            const name = title === null ? MISSING : title === '' ? UNREAD : (title ?? '');
            return (
              <li key={id} className={title === null ? 'gone' : undefined}>
                <span>{name}</span>
                <button
                  type="button"
                  className="ghost"
                  aria-label={`${name || label} 빼기`}
                  onClick={() => remove(id)}
                >
                  빼기
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {full ? (
        <small>{max}개까지 고를 수 있어요</small>
      ) : (
        <input
          id={inputId}
          ref={input}
          className="input"
          value={query}
          maxLength={200}
          placeholder="위키 찾기"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
      )}
      {shown.length > 0 && (
        <ul className="wiki-pick-hits" aria-label={`${label} 찾은 결과`}>
          {shown.map((wiki) => (
            <li key={wiki.id}>
              <button type="button" onClick={() => pick(wiki)}>
                {wiki.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <small aria-live="polite">
        {failed ?? (hits && shown.length === 0 ? '찾은 위키 없음' : '')}
      </small>
    </div>
  );
}
