'use client';

import { useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';

// 비밀번호 바꾸기. 바꾸면 지금 로그인만 남고 다른 기기의 로그인은 끝난다.
export function AccountForm({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  // 두 번 넣은 새 비밀번호가 다르다 (서버에 보내기 전에 막는다)
  const [mismatch, setMismatch] = useState(false);
  const action = useAction();
  const busy = action.busy !== null;
  const error = mismatch ? '새 비밀번호를 똑같이 두 번 넣어 주세요' : action.problem;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMismatch(next !== again);
    if (next !== again) return;
    const reply = await action.run('save', () =>
      api('PUT', '/api/auth/password', { current, next }),
    );
    if (!reply?.ok) return;
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
