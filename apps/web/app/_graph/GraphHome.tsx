'use client';

import { useEffect, useState } from 'react';
import { AccountForm } from '../_admin/AccountForm';
import { BlogForm } from '../_admin/BlogForm';
import { PluginsPanel } from '../_admin/PluginsPanel';
import { api } from '../_lib/client-api';
import type { Owner, SpaceInfo } from '../_lib/types';
import { CairnMark } from '../_ui/CairnMark';
import { useToast } from '../_ui/useToast';

type Sheet = 'blog' | 'plugins' | 'account' | null;

// 그래프 홈 (기준 시안 "밤길"). 방문자 화면과 관리 모드가 같은 무대를 쓴다.
// 그래프의 점·선은 세션이 들어오고 그래프 API(M2)가 생기면 이 무대 위에 그린다. 지금은 빈 그래프 안내.
export function GraphHome({ space, owner }: { space: SpaceInfo; owner: Owner | null }) {
  const [admin, setAdmin] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [info, setInfo] = useState(space);
  const [toast, showToast] = useToast();

  // 마우스를 따라 무대가 등불처럼 밝아진다
  useEffect(() => {
    const move = (e: PointerEvent) => {
      document.documentElement.style.setProperty('--mx', `${e.clientX}px`);
      document.documentElement.style.setProperty('--my', `${e.clientY}px`);
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);

  function toggleAdmin() {
    const next = !admin;
    setAdmin(next);
    setSheet(next ? 'blog' : null);
    showToast(
      next ? '관리자 화면이에요. 방문자에게는 보이지 않아요' : '방문자 화면으로 돌아왔어요',
    );
  }

  async function logout() {
    await api('POST', '/api/auth/logout');
    window.location.href = '/';
  }

  const title = info.name || 'cairn';

  return (
    <>
      <div className="stage" aria-hidden="true" />
      <div className="spot" aria-hidden="true" />

      <header className="top">
        <a className="brand" href="/" aria-label="그래프 홈">
          <CairnMark />
          {title}
        </a>
        <div className="top-right">
          {owner ? (
            <>
              <button type="button" className="mode" aria-pressed={admin} onClick={toggleAdmin}>
                <span className="led" />
                {admin ? '관리 모드' : '관리자 화면 보기'}
              </button>
            </>
          ) : info.installed ? (
            <a className="mode" href="/login">
              <span className="led" />
              주인 로그인
            </a>
          ) : (
            <a className="mode" href="/install">
              <span className="led" />
              설치하기
            </a>
          )}
        </div>
      </header>

      <main className="empty">
        <CairnMark size={96} stack />
        {info.installed ? (
          <>
            <h1>아직 쌓인 세션이 없어요</h1>
            <p>
              {owner
                ? 'AI 도구를 연결하고 작업을 저장하면, 정리 전 세션이 도착 구역에 점으로 생겨요. 정리하면 wiki와 카테고리로 이어져 그래프가 자라요.'
                : 'AI와 함께 한 작업이 쌓이면 여기에 그래프로 보여요.'}
            </p>
          </>
        ) : (
          <>
            <h1>아직 설치 전이에요</h1>
            <p>
              서버를 가진 사람만 설치할 수 있어요. 서버 로그나 <code>pnpm install-code</code>로 설치
              코드를 확인하세요.
            </p>
            <a className="cta" href="/install" style={{ minWidth: 220 }}>
              <span>설치 시작</span>
              <span className="arr">→</span>
            </a>
          </>
        )}
      </main>

      {admin && sheet === 'blog' && (
        <section className="sheet" aria-label="블로그 정보">
          <div className="sheet-head">
            <h2>블로그</h2>
            <small>이름·소개·주소</small>
          </div>
          <BlogForm
            space={info}
            submitLabel="저장"
            onSaved={(next) => {
              setInfo(next);
              showToast('블로그 정보를 저장했어요');
            }}
          />
        </section>
      )}
      {admin && sheet === 'account' && (
        <section className="sheet" aria-label="계정">
          <div className="sheet-head">
            <h2>계정</h2>
            <button type="button" className="ghost" onClick={logout}>
              로그아웃
            </button>
          </div>
          <p className="label-mono" style={{ margin: '0 0 14px' }}>
            {owner ? `${owner.login}(으)로 로그인함` : ''}
          </p>
          <AccountForm
            onChanged={() => showToast('비밀번호를 바꿨어요. 다른 기기의 로그인은 끝났어요')}
          />
        </section>
      )}
      {admin && sheet === 'plugins' && (
        <section className="sheet" aria-label="플러그인">
          <div className="sheet-head">
            <h2>플러그인</h2>
            <small>켜고 끄면 재시작 없이 반영돼요</small>
          </div>
          <PluginsPanel onMessage={showToast} />
        </section>
      )}

      <nav className="dock" aria-label="메뉴">
        {admin ? (
          <>
            <button
              type="button"
              aria-current={sheet === 'blog'}
              onClick={() => setSheet(sheet === 'blog' ? null : 'blog')}
            >
              블로그
            </button>
            <button
              type="button"
              aria-current={sheet === 'plugins'}
              onClick={() => setSheet(sheet === 'plugins' ? null : 'plugins')}
            >
              플러그인
            </button>
            <button
              type="button"
              aria-current={sheet === 'account'}
              onClick={() => setSheet(sheet === 'account' ? null : 'account')}
            >
              계정
            </button>
          </>
        ) : (
          <button type="button" aria-current="true">
            그래프
          </button>
        )}
      </nav>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
