'use client';

import Link from 'next/link';
import { useState } from 'react';
import { actionLabel, DELIVER_LABELS } from '../../_task/labels';
import { OutputOpen } from '../../_task/parts';
import type { ChatCard } from '../../_task/types';

// 결과 카드 (2차 2단계): 항목(결과물 · 동작)마다 고르고, 승인(고른 개수) · 수정 요청 · 반려.
// 승인하면 고른 동작은 실행되고 고르지 않은 동작은 반려, 고르지 않은 결과물은 휴지통(30일). 수정 요청은 메모가 다음 회차로.
// 고른 것 · 메모는 이 폼의 상태다. 결정은 패널이 보낸다 (카드가 바뀌면 key로 새로 그린다)
export function ChatCardForm({
  card,
  busy,
  problem,
  onDecide,
}: {
  card: ChatCard;
  busy: boolean;
  problem: string | null;
  onDecide: (body: { decision: string; note?: string; picked?: string[] }) => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(card.items.map((i) => i.id)),
  );
  const [note, setNote] = useState('');

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  return (
    <section className="panel result-card" aria-labelledby="result-card">
      <div className="sec-title flat">
        <h2 id="result-card">결과 카드</h2>
        <small className="label-mono">회차 {card.turn}</small>
      </div>
      {card.deliver && (
        <p className={card.passed ? 'note' : 'warn'}>
          받을 것 · {DELIVER_LABELS[card.deliver] ?? card.deliver}{' '}
          {card.passed ? '· 검사 통과' : '· 검사에 떨어짐 (결과에 없음)'}
        </p>
      )}
      {card.review && (
        <div className="result-review">
          <small>검토 의견</small>
          <p className="text">{card.review}</p>
        </div>
      )}
      <ul className="list" aria-label="결과 항목">
        {card.items.map((item) => (
          <li key={item.id} className="list-cell result-item">
            <label className="result-pick">
              <input
                type="checkbox"
                checked={picked.has(item.id)}
                onChange={() => toggle(item.id)}
              />
              <span>
                <b>{item.kind === 'action' ? actionLabel(item.label) : item.label}</b>
                <small>
                  {item.kind === 'action'
                    ? '동작 · 승인하면 실행'
                    : '결과물 · 고르지 않으면 휴지통'}
                  {item.note ? ` · ${item.note}` : ''}
                </small>
              </span>
            </label>
            {item.kind === 'output' ? (
              <OutputOpen id={item.id} name={item.label} />
            ) : (
              // 대상의 실제 내용(글 · 클릭의 페이지 · 버튼 · 화면 · PR)은 결재 화면이 대상 모듈에서 읽어 보인다
              <Link className="ghost" href={`/admin/approvals/${item.id}`}>
                자세히
              </Link>
            )}
          </li>
        ))}
      </ul>
      <label className="field">
        <span>메모 (수정 요청이면 꼭)</span>
        <textarea
          className="input"
          rows={2}
          maxLength={4000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="row result-actions">
        <button
          type="button"
          className="cta small"
          disabled={busy}
          onClick={() =>
            onDecide({ decision: 'approve', picked: [...picked], ...(note.trim() ? { note } : {}) })
          }
        >
          승인 ({picked.size}/{card.items.length})
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy || !note.trim()}
          onClick={() => onDecide({ decision: 'revise', note })}
        >
          수정 요청
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => onDecide({ decision: 'reject', ...(note.trim() ? { note } : {}) })}
        >
          반려
        </button>
      </div>
    </section>
  );
}
