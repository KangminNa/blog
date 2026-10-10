'use client';

import { useState } from 'react';
import { BlogForm } from '../_admin/BlogForm';
import { PluginsPanel } from '../_admin/PluginsPanel';
import { api, describe } from '../_lib/client-api';
import type { InstallStatus, Owner, SpaceInfo } from '../_lib/types';
import { CairnMark } from '../_ui/CairnMark';
import { useToast } from '../_ui/useToast';

// 설치 마법사 5단계. 앞의 둘(설치 코드 → 주인 계정)은 아직 주인이 없을 때,
// 뒤의 셋(블로그 정보 → 플러그인 → 첫 기기)은 주인으로 로그인한 뒤.
const STEPS = ['설치 코드', '주인 계정', '블로그 정보', '플러그인', '첫 기기'] as const;
type Step = 0 | 1 | 2 | 3 | 4;

function startStep(status: InstallStatus, owner: Owner | null): Step | 'not-owner' {
  if (status.installed) return owner ? 2 : 'not-owner';
  return status.step === 'code' ? 0 : 1;
}

export function InstallWizard({
  status,
  space,
  owner,
}: {
  status: InstallStatus;
  space: SpaceInfo;
  owner: Owner | null;
}) {
  const start = startStep(status, owner);
  const [step, setStep] = useState<Step>(start === 'not-owner' ? 0 : start);
  const [login, setLogin] = useState(owner?.login ?? null);
  const [info, setInfo] = useState(space);
  const [toast, showToast] = useToast();

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
        <section className="panel-card" aria-label="설치">
          {start === 'not-owner' ? (
            <NotOwner />
          ) : (
            <>
              <Progress step={step} />
              {step === 0 && <CodeStep onDone={() => setStep(1)} />}
              {step === 1 && (
                <OwnerStep
                  onDone={(name) => {
                    setLogin(name);
                    setStep(2);
                  }}
                />
              )}
              {step === 2 && (
                <>
                  <h1>블로그 정보</h1>
                  {login && <p>{login} 계정으로 로그인했어요. 이 계정이 블로그의 주인이에요.</p>}
                  <BlogForm
                    space={{ ...info, installed: true }}
                    submitLabel="다음"
                    onSaved={(next) => {
                      setInfo(next);
                      setStep(3);
                    }}
                  />
                </>
              )}
              {step === 3 && (
                <>
                  <h1>플러그인</h1>
                  <p>필요한 것만 켜요. 나중에 관리 화면에서 언제든 바꿀 수 있어요.</p>
                  <PluginsPanel onMessage={showToast} />
                  <button className="cta" type="button" onClick={() => setStep(4)}>
                    <span>다음</span>
                    <span className="arr">→</span>
                  </button>
                </>
              )}
              {step === 4 && <DeviceStep />}
            </>
          )}
        </section>
      </main>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}

function Progress({ step }: { step: Step }) {
  return (
    <div className="steps">
      {STEPS.map((name, i) => (
        <i
          key={name}
          aria-hidden="true"
          className={i < step ? 'done' : i === step ? 'now' : undefined}
        />
      ))}
      <span style={{ marginLeft: 8 }}>
        {step + 1}/{STEPS.length} {STEPS[step]}
      </span>
    </div>
  );
}

function CodeStep({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const reply = await api('POST', '/api/install/verify', { code });
    setBusy(false);
    if (reply.ok) return onDone();
    setError(describe(reply.error));
  }

  return (
    <form onSubmit={verify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <CairnMark size={64} stack />
      <h1>내 서버에 Cairn을 설치해요</h1>
      <p>
        서버를 가진 사람인지 확인할게요. 서버 로그에 나온 설치 코드를 넣어 주세요. 터미널에서{' '}
        <code>pnpm install-code</code>로도 볼 수 있어요.
      </p>
      <label className="field">
        <span>설치 코드</span>
        <input
          className="input code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="cta" type="submit" disabled={busy || code.trim().length < 8}>
        <span>{busy ? '확인하는 중' : '확인'}</span>
        <span className="arr">→</span>
      </button>
    </form>
  );
}

function OwnerStep({ onDone }: { onDone: (login: string) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (password !== again) return setError('비밀번호가 서로 달라요');
    setBusy(true);
    setError(null);
    const reply = await api('POST', '/api/install/owner', { login, password });
    setBusy(false);
    if (reply.ok) return onDone(login.trim().toLowerCase());
    setError(
      reply.status === 401
        ? '설치 코드 확인이 만료됐어요. 새로 고친 뒤 코드를 다시 넣어 주세요'
        : describe(reply.error),
    );
  }

  return (
    <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h1>주인 계정을 만들어요</h1>
      <p>이 블로그를 관리할 계정이에요. 주인은 한 명이고, 만들면 바로 로그인돼요.</p>
      <label className="field">
        <span>아이디</span>
        <input
          className="input"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          pattern="[A-Za-z0-9_\-]{3,40}"
          maxLength={40}
          required
        />
        <small>영문 소문자·숫자·-·_로 3~40자</small>
      </label>
      <label className="field">
        <span>비밀번호</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <small>10자 이상. 긴 문장도 좋아요. 서버에는 되돌릴 수 없는 값으로만 저장해요</small>
      </label>
      <label className="field">
        <span>비밀번호 한 번 더</span>
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
      <button
        className="cta"
        type="submit"
        disabled={busy || login.length < 3 || password.length < 10}
      >
        <span>{busy ? '만드는 중' : '주인 계정 만들기'}</span>
        <span className="arr">→</span>
      </button>
    </form>
  );
}

function DeviceStep() {
  return (
    <>
      <h1>설치가 끝났어요</h1>
      <p>
        마지막 단계는 AI 도구(Claude Code)를 연결해 세션을 저장하는 거예요. 기기 연결은 다음
        업데이트에서 이 자리에 열려요. 지금은 그래프로 가서 둘러보세요.
      </p>
      <a className="cta" href="/">
        <span>그래프로</span>
        <span className="arr">→</span>
      </a>
    </>
  );
}

function NotOwner() {
  return (
    <>
      <CairnMark size={64} stack />
      <h1>이미 설치된 블로그예요</h1>
      <p>주인 계정으로 로그인하면 남은 설정(블로그 정보, 플러그인)을 이어서 할 수 있어요.</p>
      <a className="cta" href="/login?return=/install">
        <span>주인 로그인</span>
        <span className="arr">→</span>
      </a>
    </>
  );
}
