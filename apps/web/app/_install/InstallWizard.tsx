'use client';

import { useCallback, useState } from 'react';
import { BlogForm } from '../_admin/BlogForm';
import { DevicesPanel } from '../_admin/DevicesPanel';
import { PluginsPanel } from '../_admin/PluginsPanel';
import { api, describe } from '../_lib/client-api';
import type { Device, InstallStatus, Owner, SpaceInfo } from '../_lib/types';
import { CairnMark } from '../_ui/CairnMark';
import { useToast } from '../_ui/useToast';

// 설치 마법사 5단계. 앞의 둘(설치 코드 → 주인 계정)은 아직 주인이 없을 때,
// 뒤의 셋(블로그 정보 → 플러그인 → 첫 기기)은 주인으로 로그인한 뒤.
const STEPS = ['설치 코드', '관리자 계정', '블로그 정보', '플러그인', '첫 기기'] as const;
type Step = 0 | 1 | 2 | 3 | 4;

/** 이전 단계로 갈 수 있는 곳. 주인 계정을 만든 뒤에는 그 앞(설치 코드·계정)으로 돌아가지 않는다 */
function previousStep(step: Step): Step | null {
  return step === 1 ? 0 : step === 3 ? 2 : step === 4 ? 3 : null;
}

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
  const back = previousStep(step);

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
              <Progress step={step} onBack={back === null ? null : () => setStep(back)} />
              {step === 0 && <CodeStep onDone={() => setStep(1)} />}
              {step === 1 && (
                <OwnerStep
                  onDone={async (name) => {
                    // 계정을 만든 순간 공간이 생겼으므로, 블로그 정보를 새로 받아 버전을 맞춘다
                    const fresh = await api<SpaceInfo>('GET', '/api/space');
                    if (fresh.ok) setInfo(fresh.data);
                    setLogin(name);
                    setStep(2);
                  }}
                />
              )}
              {step === 2 && (
                <>
                  <h1>블로그 정보</h1>
                  {login && <p>{login}(으)로 로그인했어요.</p>}
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
              {step === 4 && <DeviceStep siteUrl={info.siteUrl} onMessage={showToast} />}
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

function Progress({ step, onBack }: { step: Step; onBack: (() => void) | null }) {
  return (
    <div className="steps">
      {onBack && (
        <button type="button" className="back" onClick={onBack} aria-label="이전 단계">
          ←
        </button>
      )}
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

function OwnerStep({ onDone }: { onDone: (login: string) => Promise<void> }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (password !== again) return setError('비밀번호를 똑같이 두 번 넣어 주세요');
    setBusy(true);
    setError(null);
    const reply = await api('POST', '/api/install/owner', { login, password });
    setBusy(false);
    if (reply.ok) return void (await onDone(login.trim().toLowerCase()));
    setError(
      reply.status === 401
        ? '새로 고친 뒤 설치 코드를 다시 넣어 주세요 (10분 지남)'
        : describe(reply.error),
    );
  }

  return (
    <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h1>관리자 계정을 만들어요</h1>
      <p>블로그를 관리할 계정이에요. 하나만 만들 수 있고, 만들면 바로 로그인돼요.</p>
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
        <span>{busy ? '만드는 중' : '관리자 계정 만들기'}</span>
        <span className="arr">→</span>
      </button>
    </form>
  );
}

function DeviceStep({
  siteUrl,
  onMessage,
}: {
  siteUrl: string | null;
  onMessage: (t: string) => void;
}) {
  const [connected, setConnected] = useState<string | null>(null);
  const watch = useCallback((devices: Device[]) => {
    const live = devices.find((d) => !d.revokedAt);
    if (live) setConnected(live.name);
  }, []);
  return (
    <>
      <h1>{connected ? '첫 기기를 연결했어요' : '첫 기기를 연결해요'}</h1>
      <p>
        {connected
          ? `${connected} 연결 완료. 이제 작업한 세션을 저장할 수 있어요.`
          : 'Claude Code를 쓰는 컴퓨터의 터미널에서 아래 명령을 실행하고 /mcp에서 cairn에 로그인하세요. 브라우저에서 연결을 누르면 끝나요.'}
      </p>
      <DevicesPanel siteUrl={siteUrl} onMessage={onMessage} onChange={watch} />
      <a className={connected ? 'cta' : 'ghost wide'} href="/">
        {connected ? (
          <>
            <span>그래프로</span>
            <span className="arr">→</span>
          </>
        ) : (
          '나중에 하기'
        )}
      </a>
    </>
  );
}

function NotOwner() {
  return (
    <>
      <CairnMark size={64} stack />
      <h1>이미 설치된 블로그예요</h1>
      <p>로그인하면 남은 설정(블로그 정보, 플러그인)을 이어서 할 수 있어요.</p>
      <a className="cta" href="/login?return=/install">
        <span>로그인</span>
        <span className="arr">→</span>
      </a>
    </>
  );
}
