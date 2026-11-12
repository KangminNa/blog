'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { TOOL_LABELS, when } from '../../_task/labels';
import { TASK_TOPICS, useAiTools } from '../../_task/live';
import type { AiTest, AiTool, Task, TaskDetail } from '../../_task/types';
import { useNotify } from '../../_ui/notify';

type Signin = NonNullable<AiTool['signin']>;

const DAY_MS = 86_400_000;
/** 만료가 이만큼 남으면 알린다 */
const WARN_DAYS = 30;
/** 로그인 단계는 작업의 상태가 아니라서 신호가 없다. 로그인하는 동안만 이 간격으로 다시 읽는다 */
const SIGNIN_REREAD_MS = 2_000;

function stateOf(tool: AiTool): string {
  if (tool.connected) return '연결됨';
  return tool.expiresAt ? '만료됨' : '로그인 전';
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

/** 서버가 정해진 출처만 받지만, 링크로 여는 것은 https일 때만 */
function safeUrl(url: string | null): string | null {
  return url?.startsWith('https://') ? url : null;
}

// AI 로그인. 러너가 로그인 명령을 대신 돌리고(웹 로그인), 주인은 주소에서 로그인해 코드를 붙여 넣는다.
// Claude는 토큰을 직접 넣을 수도 있다. 토큰은 서버가 돌려주지 않아 화면에 다시 보이지 않는다.
export function AiPanel() {
  const tools = useAiTools();
  const { reload } = tools;
  const signingIn = tools.data?.tools.some((t) => t.signin !== null) ?? false;
  useEffect(() => {
    if (!signingIn) return;
    const timer = setInterval(() => void reload(), SIGNIN_REREAD_MS);
    return () => clearInterval(timer);
  }, [signingIn, reload]);

  return (
    <>
      <header className="page-head">
        <h1>AI</h1>
      </header>
      {tools.error && <p className="error">{tools.error}</p>}
      {tools.data
        ? tools.data.tools.map((tool) => <ToolCard key={tool.tool} tool={tool} reload={reload} />)
        : !tools.error && <p className="label-mono">불러오는 중…</p>}
      <p className="note">
        로그인은 러너가 돌려요. 러너가 꺼져 있으면 시작되지 않아요 ·{' '}
        <Link href="/admin/runners">러너 메뉴</Link>
      </p>
    </>
  );
}

function ToolCard({ tool, reload }: { tool: AiTool; reload: () => Promise<void> }) {
  const claude = tool.tool === 'claude';
  const name = TOOL_LABELS[tool.tool] ?? tool.tool;
  return (
    <section className="panel" aria-label={name}>
      <h2>{name}</h2>
      {claude ? (
        <ClaudeState tool={tool} />
      ) : (
        <dl className="kv">
          <dt>상태</dt>
          <dd>{stateOf(tool)}</dd>
        </dl>
      )}
      <SigninBox tool={tool} reload={reload} />
      {claude ? (
        <details className="more">
          <summary>토큰 직접 넣기</summary>
          <TokenForm tool={tool} reload={reload} />
        </details>
      ) : (
        <p className="note">
          에이전트의 AI 도구를 Codex로 고르면 이 로그인으로 일해요. 셸 없이 cairn 도구만 써요
        </p>
      )}
    </section>
  );
}

/** Claude: 만료와 연결 확인 */
function ClaudeState({ tool }: { tool: AiTool }) {
  const action = useAction();
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

  async function startTest() {
    const reply = await action.run('test', () => api<AiTest>('POST', '/api/ai/claude/test'));
    if (reply?.ok) setTesting(reply.data.taskId);
  }

  return (
    <>
      {action.problem && <p className="error">{action.problem}</p>}
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
          <span className="pill strong">만료 {left}일 전 · 다시 로그인 필요</span>
        </p>
      )}
      {tool.connected && (
        <button
          type="button"
          className="ghost fit"
          disabled={action.busy !== null || pending}
          onClick={startTest}
        >
          연결 확인
        </button>
      )}
      {pending && <p className="note">러너가 일을 맡으면 끝나요</p>}
    </>
  );
}

/**
 * 웹 로그인. 진행 중인 로그인은 /api/ai의 signin으로 온다 (새로 고쳐도 이어진다).
 * 이 화면에서 시작한 로그인이 끝나면 작업을 읽어 실패 이유를 보인다
 */
function SigninBox({ tool, reload }: { tool: AiTool; reload: () => Promise<void> }) {
  const notify = useNotify();
  const name = TOOL_LABELS[tool.tool] ?? tool.tool;
  const action = useAction();
  const busy = action.busy !== null;
  const [started, setStarted] = useState<string | null>(null);
  const signin = tool.signin;
  const ended = useLiveValue(
    `ai-signin:${started}`,
    () =>
      started && signin === null
        ? api<TaskDetail>('GET', `/api/tasks/${started}`)
        : Promise.resolve({ ok: true as const, data: null }),
    TASK_TOPICS,
  );
  const result = ended.data;
  const failure =
    result?.status === 'failed'
      ? String((result.result as { error?: unknown } | null)?.error ?? '로그인하지 못했어요')
      : null;

  useEffect(() => {
    if (result?.status !== 'done') return;
    notify(`${name} 로그인됨`);
    setStarted(null);
  }, [result?.status, name, notify]);

  async function start() {
    const reply = await action.run('start', () =>
      api<AiTest>('POST', `/api/ai/${tool.tool}/signin`),
    );
    if (!reply?.ok) return;
    setStarted(reply.data.taskId);
    await reload();
  }

  // 취소에는 작업의 지금 version이 든다: 누를 때 읽어서 보낸다
  async function cancel(taskId: string) {
    await action.run('cancel', async () => {
      const task = await api<TaskDetail>('GET', `/api/tasks/${taskId}`);
      return task.ok
        ? api('POST', `/api/tasks/${taskId}/cancel`, { version: task.data.version })
        : task;
    });
    setStarted(null);
    await reload();
  }

  if (signin === null)
    return (
      <div className="stack">
        {action.problem && <p className="error">{action.problem}</p>}
        {failure && <p className="error">{failure}</p>}
        <button
          type="button"
          className={tool.connected ? 'ghost fit' : 'cta small fit'}
          disabled={busy}
          onClick={start}
        >
          {tool.connected ? '다시 로그인' : '브라우저로 로그인'}
        </button>
      </div>
    );

  return (
    <section className="stack" aria-label={`${name} 로그인`}>
      {action.problem && <p className="error">{action.problem}</p>}
      <SigninSteps signin={signin} tool={tool.tool} />
      <button
        type="button"
        className="ghost fit"
        disabled={busy}
        onClick={() => cancel(signin.taskId)}
      >
        로그인 취소
      </button>
    </section>
  );
}

function SigninSteps({ signin, tool }: { signin: Signin; tool: string }) {
  const url = safeUrl(signin.url);
  if (signin.step === 'starting' || url === null)
    return <p className="label-mono">러너가 로그인을 여는 중…</p>;
  if (signin.step === 'verifying') return <p className="label-mono">코드를 확인하는 중…</p>;
  const open = (
    <a className="cta small fit" href={url} target="_blank" rel="noopener noreferrer">
      로그인 페이지 열기
    </a>
  );
  if (tool === 'codex')
    return (
      <ol className="signin-steps">
        <li>
          <span>로그인 페이지에서 로그인</span>
          {open}
        </li>
        <li>
          <span>이 코드 넣기</span>
          <code className="signin-code">{signin.userCode}</code>
          <small className="note">넣으면 저절로 연결돼요. 남이 보낸 코드는 넣지 마세요</small>
        </li>
      </ol>
    );
  return (
    <ol className="signin-steps">
      <li>
        <span>로그인 페이지에서 로그인</span>
        {open}
      </li>
      <li>
        <span>브라우저에 나온 코드 붙여 넣기</span>
        <CodeForm taskId={signin.taskId} />
      </li>
    </ol>
  );
}

/** Claude: 브라우저에 나온 코드. 러너가 받아 로그인 명령에 쳐 넣는다 */
function CodeForm({ taskId }: { taskId: string }) {
  const action = useAction();
  const [code, setCode] = useState('');

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('code', () =>
      api('POST', '/api/ai/claude/signin/code', { taskId, code: code.trim() }),
    );
    if (reply?.ok) setCode('');
  }

  return (
    <form className="row" onSubmit={send}>
      <input
        className="input"
        aria-label="로그인 코드"
        autoComplete="off"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      <button className="cta small" type="submit" disabled={action.busy !== null || !code.trim()}>
        넣기
      </button>
      {action.problem && <p className="error">{action.problem}</p>}
    </form>
  );
}

/** Claude: claude setup-token으로 직접 만든 토큰 */
function TokenForm({ tool, reload }: { tool: AiTool; reload: () => Promise<void> }) {
  const action = useAction();
  const [token, setToken] = useState('');

  function save(event: React.FormEvent) {
    event.preventDefault();
    void action.run(
      'token',
      async () => {
        const reply = await api('PUT', '/api/ai/claude/token', { token: token.trim() });
        // 틀린 값도 칸에 남기지 않는다. 가려져 있어 고칠 수 없고 다시 붙여 넣으면 된다
        setToken('');
        return reply;
      },
      { done: '토큰 저장됨', reload },
    );
  }

  return (
    <form className="stack" onSubmit={save}>
      {action.problem && <p className="error">{action.problem}</p>}
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
      <button
        className="cta small fit"
        type="submit"
        disabled={action.busy !== null || !token.trim()}
      >
        저장
      </button>
    </form>
  );
}
