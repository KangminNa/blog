'use client';

import type { LoginLinkList, LoginMethodList } from '../../_account/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';

// 계정 화면의 "연결된 로그인": 켜진 로그인 플러그인마다 연결하거나 끊는다.
// 연결해 둔 외부 계정으로만 로그인되므로, 플러그인이 아무 계정이나 주인으로 만들 수 없다.
export function LinkedLogins({ onMessage }: { onMessage: (text: string) => void }) {
  // 로그인 방법과 연결에는 변경 신호가 없다. 연결을 못 읽으면 "연결 안 됨"으로 보인다
  const found = useLiveValue(
    'login-methods',
    () => api<LoginMethodList>('GET', '/api/auth/methods'),
    [],
  );
  const linked = useLiveValue(
    'login-links',
    () => api<LoginLinkList>('GET', '/api/auth/links'),
    [],
  );
  const action = useAction();
  const methods = found.data?.methods ?? null;
  const links = linked.data?.links ?? [];
  const error = action.problem ?? found.error;

  async function unlink(method: string) {
    const reply = await action.run(method, () => api('DELETE', `/api/auth/links/${method}`), {
      reload: () => Promise.all([found.reload(), linked.reload()]),
    });
    if (reply?.ok) onMessage('연결을 끊었어요. 그 계정으로는 더 로그인할 수 없어요');
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
                <button
                  type="button"
                  className="ghost"
                  disabled={action.busy === m.method}
                  onClick={() => unlink(m.method)}
                >
                  끊기
                </button>
              ) : (
                <a
                  className="ghost"
                  href={`/api/auth/links/${m.method}/start?return=${encodeURIComponent('/admin/account')}`}
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
