'use client';

import { useState } from 'react';
import { api, describe } from '../_lib/client-api';
import { CairnMark } from '../_ui/CairnMark';

// 주인 로그인 카드. 그래프 무대 위 가운데.
export function LoginForm({ returnTo }: { returnTo: string }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const reply = await api('POST', '/api/auth/login', { login, password });
    setBusy(false);
    if (!reply.ok) return setError(describe(reply.error));
    window.location.href = returnTo;
  }

  return (
    <>
      <div className="stage" aria-hidden="true" />
      <header className="top">
        <a className="brand" href="/" aria-label="그래프 홈">
          <CairnMark />
          cairn
        </a>
      </header>
      <main className="center">
        <form className="panel-card" onSubmit={submit} aria-label="주인 로그인">
          <CairnMark size={56} stack />
          <h1>주인 로그인</h1>
          <label className="field">
            <span>아이디</span>
            <input
              className="input"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          <label className="field">
            <span>비밀번호</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="cta" type="submit" disabled={busy || !login || !password}>
            <span>{busy ? '확인하는 중' : '로그인'}</span>
            <span className="arr">→</span>
          </button>
          <p className="label-mono">
            비밀번호를 잊었다면 서버에서 <code>pnpm owner reset-password</code>로 다시 정해요.
          </p>
        </form>
      </main>
    </>
  );
}
