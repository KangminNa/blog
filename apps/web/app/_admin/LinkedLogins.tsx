'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, describe } from '../_lib/client-api';
import type { LoginLink, LoginMethod } from '../_lib/types';

// 계정 시트의 "연결된 로그인": 켜진 로그인 플러그인마다 연결하거나 끊는다.
// 연결해 둔 외부 계정으로만 로그인되므로, 플러그인이 아무 계정이나 주인으로 만들 수 없다.
export function LinkedLogins({ onMessage }: { onMessage: (text: string) => void }) {
  const [methods, setMethods] = useState<LoginMethod[] | null>(null);
  const [links, setLinks] = useState<LoginLink[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, l] = await Promise.all([
      api<{ methods: LoginMethod[] }>('GET', '/api/auth/methods'),
      api<{ links: LoginLink[] }>('GET', '/api/auth/links'),
    ]);
    if (m.ok) setMethods(m.data.methods);
    if (l.ok) setLinks(l.data.links);
    if (!m.ok) setError(describe(m.error));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unlink(method: string) {
    const reply = await api('DELETE', `/api/auth/links/${method}`);
    if (!reply.ok) return setError(describe(reply.error));
    onMessage('연결을 끊었어요. 그 계정으로는 더 로그인할 수 없어요');
    await load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!methods) return null;
  return (
    <div className="field">
      <span>연결된 로그인</span>
      {methods.length === 0 ? (
        <small>로그인 플러그인(예: login-github)을 켜면 그 계정으로도 로그인할 수 있어요</small>
      ) : (
        methods.map((m) => {
          const link = links.find((l) => l.method === m.method);
          return (
            <div key={m.method} className="copy" style={{ justifyContent: 'space-between' }}>
              <span>
                {m.method} · {link ? `${link.label} 연결됨` : '연결 안 됨'}
              </span>
              {link ? (
                <button type="button" className="ghost" onClick={() => unlink(m.method)}>
                  끊기
                </button>
              ) : (
                <a
                  className="ghost"
                  href={`/api/auth/links/${m.method}/start?return=${encodeURIComponent('/?sheet=account')}`}
                >
                  연결하기
                </a>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
