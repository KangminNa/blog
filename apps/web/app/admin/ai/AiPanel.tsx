'use client';

import { useState } from 'react';
import type {
  AiTestView,
  AiToolListView,
} from '../../../../server/src/modules/task/ai/ai-login.view';
import { api, describe } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';
import { TOOL_LABELS, when } from '../../_task/labels';
import { TASK_TOPICS } from '../../_task/live';
import type { Task } from '../../_task/types';
import { useNotify } from '../AdminShell';

type AiTools = ReturnType<AiToolListView['toJSON']>;
type AiTool = AiTools['tools'][number];
type AiTest = ReturnType<AiTestView['toJSON']>;

const DAY_MS = 86_400_000;
/** 만료가 이만큼 남으면 알린다 */
const WARN_DAYS = 30;

function stateOf(tool: AiTool): string {
  if (tool.connected) return '연결됨';
  return tool.expiresAt ? '만료됨' : '토큰 없음';
}

/** 만료까지 남은 날. 지났으면 null */
function daysLeft(expiresAt: string): number | null {
  const left = new Date(expiresAt).getTime() - Date.now();
  return left > 0 ? Math.ceil(left / DAY_MS) : null;
}

function checkOf(tool: AiTool): string {
  if (!tool.checkedAt) return '확인 전';
  return `${tool.lastError ? '실패' : '정상'} · ${when(tool.checkedAt)}`;
}

// AI 로그인: 서버 러너가 쓸 토큰 넣기, 만료, 연결 확인. 토큰은 서버가 돌려주지 않아 화면에 다시 보이지 않는다.
export function AiPanel() {
  const tools = useLiveValue('ai', () => api<AiTools>('GET', '/api/ai'), TASK_TOPICS);
  const claude = tools.data?.tools.find((t) => t.tool === 'claude');
  return (
    <>
      <header className="page-head">
        <h1>AI</h1>
      </header>
      {tools.error && <p className="error">{tools.error}</p>}
      {claude ? (
        <ClaudeLogin tool={claude} reload={tools.reload} />
      ) : (
        !tools.error && <p className="label-mono">불러오는 중…</p>
      )}
    </>
  );
}

function ClaudeLogin({ tool, reload }: { tool: AiTool; reload: () => Promise<void> }) {
  const notify = useNotify();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // 맡긴 연결 확인의 작업. 끝나면 결과는 /api/ai로 온다
  const [testing, setTesting] = useState<string | null>(null);
  const test = useLiveValue(
    `ai-test:${testing}`,
    () =>
      testing
        ? api<Task | null>('GET', `/api/tasks/${testing}`)
        : Promise.resolve({ ok: true as const, data: null }),
    TASK_TOPICS,
  );
  const pending =
    testing !== null && (test.data === null || ['queued', 'running'].includes(test.data.status));
  const left = tool.expiresAt ? daysLeft(tool.expiresAt) : null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const reply = await api('PUT', '/api/ai/claude/token', { token: token.trim() });
    // 틀린 값도 칸에 남기지 않는다. 가려져 있어 고칠 수 없고 다시 붙여 넣으면 된다
    setToken('');
    setBusy(false);
    if (!reply.ok) return setProblem(describe(reply.error));
    setTesting(null);
    notify('토큰 저장됨');
    await reload();
  }

  async function startTest() {
    setBusy(true);
    setProblem(null);
    const reply = await api<AiTest>('POST', '/api/ai/claude/test');
    setBusy(false);
    if (!reply.ok) return setProblem(describe(reply.error));
    setTesting(reply.data.taskId);
  }

  return (
    <>
      {problem && <p className="error">{problem}</p>}
      <div className="panel">
        <h2>{TOOL_LABELS[tool.tool] ?? tool.tool}</h2>
        <dl className="kv">
          <dt>상태</dt>
          <dd>{stateOf(tool)}</dd>
          {tool.expiresAt && (
            <>
              <dt>만료</dt>
              <dd>{new Date(tool.expiresAt).toLocaleDateString('ko-KR')}</dd>
            </>
          )}
          <dt>연결 확인</dt>
          <dd>{pending ? '확인 중' : checkOf(tool)}</dd>
          {tool.lastError && !pending && (
            <>
              <dt>이유</dt>
              <dd>{tool.lastError}</dd>
            </>
          )}
        </dl>
        {left !== null && left <= WARN_DAYS && (
          <p>
            <span className="pill strong">만료 {left}일 전 · 새 토큰 필요</span>
          </p>
        )}
        {tool.connected && (
          <button
            type="button"
            className="cta small fit"
            disabled={busy || pending}
            onClick={startTest}
          >
            연결 확인
          </button>
        )}
        {pending && <p className="note">러너가 일을 맡으면 끝나요</p>}
      </div>
      <form className="panel" onSubmit={save}>
        <label className="field">
          <span>{tool.expiresAt ? '새 토큰' : '토큰'}</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          <small>claude setup-token의 값. 끊긴 곳 없이 한 줄로</small>
        </label>
        <button className="cta small fit" type="submit" disabled={busy || !token.trim()}>
          저장
        </button>
      </form>
    </>
  );
}
