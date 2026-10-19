'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { api, describe } from '../_lib/client-api';
import type { SpaceInfo } from '../_lib/types';

// 기기 시트 맨 위의 "연결하는 법". 도구마다 길이 다르다.
//   이 컴퓨터의 도구(Claude Code · Codex): cairn connect가 스킬·검토자를 넣고 MCP 등록·로그인까지 한다
//   앱(Claude 앱 · ChatGPT): 회사 서버가 블로그로 들어오므로 "앱 연결 허용"을 켜고, 공개 https 주소가 있어야 한다.
//     스킬은 블로그가 내주는 zip(스크립트 없이 SKILL.md와 규칙만)을 사용자가 직접 올린다
const TABS = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude-app', label: 'Claude 앱' },
  { id: 'chatgpt', label: 'ChatGPT' },
] as const;

type Tab = (typeof TABS)[number]['id'];

const SKILL_ZIP = '/api/skills/cairn-save.zip';

/** 앱의 회사 서버가 들어올 수 있는 주소인가 (https이고, 이 컴퓨터·집 안 네트워크 주소가 아님) */
function isPublicHttps(url: string | null): boolean {
  if (!url) return false;
  try {
    const { protocol, hostname: h } = new URL(url);
    if (protocol !== 'https:') return false;
    return !(
      h === 'localhost' ||
      h.endsWith('.localhost') ||
      h.endsWith('.local') ||
      h === '[::1]' ||
      /^(127|10)\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  } catch {
    return false;
  }
}

export function ConnectGuide({
  siteUrl,
  onMessage,
  onSpaceChange,
}: {
  siteUrl: string | null;
  onMessage: (text: string) => void;
  /** 앱 연결 허용을 바꿨을 때 (블로그 정보의 version이 오른다) */
  onSpaceChange?: (space: SpaceInfo) => void;
}) {
  const [tab, setTab] = useState<Tab>('claude-code');
  const site = siteUrl ?? '<사이트 주소>';
  const mcp = `${site}/mcp`;

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    onMessage('복사했어요');
  }

  return (
    <div className="field">
      <span>AI 도구 연결하기</span>
      <div className="row" role="tablist" aria-label="AI 도구">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="chip"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="howto" role="tabpanel">
        {tab === 'claude-code' && (
          <>
            <CopyLine text={`pnpm cairn connect ${site}`} onCopy={copy} />
            <small>
              Cairn 저장소에서 실행. 스킬·검토자 넣기 → MCP 등록 → 브라우저 승인까지 한 번에. 다른
              회사 모델로 교차 검토하려면 끝에 <code>--review-with codex</code>
            </small>
            <Manual>
              <li>
                저장소의 <code>skills/cairn-save</code>를 <code>~/.claude/skills/</code>에 복사
              </li>
              <li>
                <code>claude mcp add --transport http --scope user cairn {mcp}</code>
              </li>
              <li>
                Claude Code에서 <code>/mcp</code> → cairn → 로그인
              </li>
            </Manual>
          </>
        )}
        {tab === 'codex' && (
          <>
            <CopyLine text={`pnpm cairn connect ${site} --tool codex`} onCopy={copy} />
            <small>
              Cairn 저장소에서 실행. 스킬·검토자 넣기 → MCP 등록 → 브라우저 승인까지 한 번에. 교차
              검토는 끝에 <code>--review-with claude</code>
            </small>
            <Manual>
              <li>
                저장소의 <code>skills/cairn-save</code>를 <code>~/.agents/skills/</code>에 복사
              </li>
              <li>
                <code>codex mcp add cairn --url {mcp}</code>
              </li>
              <li>
                <code>codex mcp login cairn</code>
              </li>
            </Manual>
          </>
        )}
        {(tab === 'claude-app' || tab === 'chatgpt') && (
          <AppSteps
            app={tab}
            siteUrl={siteUrl}
            mcp={mcp}
            onCopy={copy}
            onMessage={onMessage}
            onSpaceChange={onSpaceChange}
          />
        )}
      </div>
    </div>
  );
}

function CopyLine({ text, onCopy }: { text: string; onCopy: (text: string) => void }) {
  return (
    <div className="copy">
      <code>{text}</code>
      <button type="button" className="ghost" onClick={() => onCopy(text)}>
        복사
      </button>
    </div>
  );
}

function Manual({ children }: { children: ReactNode }) {
  return (
    <details>
      <summary>손으로 하기</summary>
      <ol>{children}</ol>
    </details>
  );
}

function AppSteps({
  app,
  siteUrl,
  mcp,
  onCopy,
  onMessage,
  onSpaceChange,
}: {
  app: 'claude-app' | 'chatgpt';
  siteUrl: string | null;
  mcp: string;
  onCopy: (text: string) => void;
  onMessage: (text: string) => void;
  onSpaceChange?: (space: SpaceInfo) => void;
}) {
  const [space, setSpace] = useState<SpaceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<SpaceInfo>('GET', '/api/space').then((reply) => {
      if (reply.ok) setSpace(reply.data);
      else setError(describe(reply.error));
    });
  }, []);

  async function toggle() {
    if (!space) return;
    setBusy(true);
    const reply = await api<SpaceInfo>('PUT', '/api/space/hosted-apps', {
      on: !space.hostedApps,
      version: space.version,
    });
    setBusy(false);
    if (!reply.ok) return setError(describe(reply.error));
    setError(null);
    setSpace(reply.data);
    onSpaceChange?.(reply.data);
    onMessage(
      reply.data.hostedApps
        ? 'ChatGPT·Claude 앱 연결을 켰어요'
        : '앱 연결을 껐어요 · 이미 연결된 앱은 아래 목록에서 끊기',
    );
  }

  const name = app === 'chatgpt' ? 'ChatGPT' : 'Claude';
  const on = space?.hostedApps ?? false;

  return (
    <>
      <div className="plugin-head">
        <div>
          <b>ChatGPT·Claude 앱 연결 허용</b>
          <p>claude.ai · chatgpt.com이 승인 뒤 돌아갈 곳으로 등록할 수 있게 해요</p>
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={on}
          aria-label={`앱 연결 ${on ? '끄기' : '켜기'}`}
          disabled={busy || !space}
          onClick={toggle}
        />
      </div>
      {error && <p className="error">{error}</p>}
      {!isPublicHttps(siteUrl) && (
        <p className="warn">
          앱은 {name} 회사 서버에서 이 블로그로 들어와요. 공개 https 주소가 필요해요 · 지금{' '}
          <code>{siteUrl ?? '주소 없음'}</code> (블로그 시트에서 바꾸기, 터널은 README)
        </p>
      )}
      <ol>
        <li>위 스위치 켜기</li>
        <li>
          {app === 'claude-app'
            ? 'Claude 설정 → 커넥터 → 커스텀 커넥터 추가, 주소:'
            : 'ChatGPT 설정 → 앱 → 고급 설정에서 개발자 모드 켜고 앱 만들기, MCP 서버 주소:'}
          <CopyLine text={mcp} onCopy={onCopy} />
        </li>
        <li>{app === 'chatgpt' && '인증은 OAuth. '}연결을 누르면 이 블로그의 승인 화면이 열려요</li>
        <li>
          {app === 'claude-app' ? '설정 → 기능 → 스킬에 ' : '스킬을 쓸 수 있으면 '}
          <a href={SKILL_ZIP} download>
            cairn-save.zip
          </a>{' '}
          올리기
          {app === 'chatgpt' && ' (없어도 저장 순서는 연결 안내에 들어 있어요)'}
        </li>
        <li>채팅에서 "이 세션 저장해"</li>
      </ol>
      <small>
        앱에서는 대화 원문 대조와 다른 맥락의 검토가 없어 미리보기에 "독립 검토 아님"이 붙어요
      </small>
    </>
  );
}
