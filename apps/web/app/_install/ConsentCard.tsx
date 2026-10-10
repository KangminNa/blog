'use client';

import { useState } from 'react';
import { api, describe } from '../_lib/client-api';
import { type Consent, SCOPE_LABELS } from '../_lib/types';
import { CairnMark } from '../_ui/CairnMark';

// 기기 연결 승인 카드. 연결하면 AI 도구가 기다리는 주소로 돌아가고, 도구가 토큰을 받아 붙는다.
export function ConsentCard({
  request,
  consent,
  problem,
}: {
  request: string;
  consent: Consent | null;
  problem: string | null;
}) {
  const [name, setName] = useState(consent?.name ?? '');
  const [error, setError] = useState<string | null>(problem);
  const [busy, setBusy] = useState(false);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const reply = await api<{ redirect: string }>(
      'POST',
      approve ? '/api/connect/approve' : '/api/connect/deny',
      approve ? { request, name } : { request },
    );
    setBusy(false);
    if (!reply.ok) return setError(describe(reply.error));
    window.location.href = reply.data.redirect;
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
        <section className="panel-card" aria-label="기기 연결">
          <CairnMark size={56} stack />
          {consent ? (
            <>
              <h1>{consent.clientName}를 연결할까요?</h1>
              <p>
                연결하면 아래 권한 안에서 세션을 올리고 읽을 수 있어요. 돌아갈 곳:{' '}
                <code>{consent.redirectHost}</code>
              </p>
              <ul className="uses" aria-label="받는 권한">
                {consent.scopes.map((s) => (
                  <li key={s}>{SCOPE_LABELS[s] ?? s}</li>
                ))}
              </ul>
              <label className="field">
                <span>기기 이름</span>
                <input
                  className="input"
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: macbook-home"
                />
                <small>관리 화면의 기기 목록에 이 이름으로 보여요. 권한 바꾸기도 거기서 해요</small>
              </label>
              {error && <p className="error">{error}</p>}
              <button
                className="cta"
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => decide(true)}
              >
                <span>{busy ? '연결하는 중' : '연결'}</span>
                <span className="arr">→</span>
              </button>
              <button
                className="ghost wide"
                type="button"
                disabled={busy}
                onClick={() => decide(false)}
              >
                거절
              </button>
            </>
          ) : (
            <>
              <h1>연결할 수 없어요</h1>
              <p className="error">{error}</p>
              <a className="cta" href="/">
                <span>그래프로</span>
                <span className="arr">→</span>
              </a>
            </>
          )}
        </section>
      </main>
    </>
  );
}
