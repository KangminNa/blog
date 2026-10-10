'use client';

import { useState } from 'react';
import { api, describe } from '../_lib/client-api';

// 비밀번호 바꾸기. 바꾸면 지금 로그인만 남고 다른 기기의 로그인은 끝난다.
export function AccountForm({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (next !== again) return setError('새 비밀번호가 서로 달라요');
    setBusy(true);
    setError(null);
    const reply = await api('PUT', '/api/auth/password', { current, next });
    setBusy(false);
    if (!reply.ok) return setError(describe(reply.error));
    setCurrent('');
    setNext('');
    setAgain('');
    onChanged();
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label className="field">
        <span>지금 비밀번호</span>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>새 비밀번호</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          minLength={10}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <small>10자 이상. 긴 문장도 좋아요</small>
      </label>
      <label className="field">
        <span>새 비밀번호 한 번 더</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="cta" type="submit" disabled={busy || !current || next.length < 10}>
        <span>{busy ? '바꾸는 중' : '비밀번호 바꾸기'}</span>
        <span className="arr">→</span>
      </button>
    </form>
  );
}
