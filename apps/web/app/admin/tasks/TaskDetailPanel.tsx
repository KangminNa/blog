'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';
import { CANCELLABLE, clock, EVENT_KINDS, TARGET_LABELS, tokens, when } from '../../_task/labels';
import { useAgents, usePendingApprovals } from '../../_task/live';
import { TaskPill } from '../../_task/parts';
import type { Task, TaskDetail, TaskEvent } from '../../_task/types';
import { useNotify } from '../AdminShell';

/** 서버가 상세에 보내는 실행 기록의 최대 개수 (TaskQuery.EVENTS) */
const EVENTS_MAX = 500;
const DETAIL_TOPICS = ['task.task.changed', 'task.event.added'];

// 작업 상세: 지시, 대상, 결과, 실행 로그. 로그는 신호가 올 때마다 다시 읽어 새로 고침 없이 늘어난다.
export function TaskDetailPanel({ id }: { id: string }) {
  const notify = useNotify();
  const task = useLiveValue(
    `task:${id}`,
    () => api<TaskDetail>('GET', `/api/tasks/${id}`),
    DETAIL_TOPICS,
    id,
  );
  const agents = useAgents();
  const approvals = usePendingApprovals();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const t = task.data;

  async function cancel() {
    if (!t) return;
    setBusy(true);
    setProblem(null);
    const reply = await api<Task>('POST', `/api/tasks/${id}/cancel`, { version: t.version });
    await task.reload();
    setBusy(false);
    if (reply.ok) return notify('작업 취소됨');
    setProblem(
      reply.status === 409
        ? '이미 바뀐 작업이에요. 최신 내용을 다시 읽었어요'
        : describe(reply.error),
    );
  }

  const back = (
    <div>
      <Link className="ghost" href="/admin/tasks">
        작업 목록
      </Link>
    </div>
  );

  if (!t)
    return (
      <>
        {back}
        {task.status === 404 ? (
          <p className="rows-empty">찾을 수 없는 작업</p>
        ) : task.error ? (
          <p className="error">{task.error}</p>
        ) : (
          <p className="label-mono">불러오는 중…</p>
        )}
      </>
    );

  const agent = agents.data?.agents.find((a) => a.id === t.agentId);
  const paused = t.status === 'queued' && agent?.status === 'paused';
  const approval = approvals.data?.approvals.find((a) => a.taskId === t.id);
  const executing = t.status === 'running' && t.leaseUntil === null;

  return (
    <>
      {back}
      <div className="page-head">
        <div className="page-title">
          <h1>{t.title}</h1>
          <p>
            {agent ? `${agent.name} 에이전트` : '자동 배정'} · {when(t.createdAt)}
          </p>
        </div>
        <TaskPill status={t.status} />
      </div>
      {paused && <p className="warn">담당 에이전트 중지됨. 재개하면 실행돼요</p>}
      {executing && <p className="warn">결재 승인됨. 실행 결과를 기다리는 중</p>}
      <section className="panel" aria-labelledby="task-instruction">
        <h2 id="task-instruction">지시</h2>
        <p className="text">{t.instruction || '지시 없음'}</p>
        <Facts task={t} />
      </section>
      <Result result={t.result} />
      <section className="panel" aria-labelledby="task-log">
        <div className="sec-title flat">
          <h2 id="task-log">실행 로그</h2>
          <span className="note">토큰 {tokens(t.events.reduce((n, e) => n + e.tokens, 0))}</span>
        </div>
        <Log status={t.status} events={t.events} />
      </section>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        {t.status === 'waiting' && (
          <Link
            className="cta small"
            href={approval ? `/admin/approvals/${approval.id}` : '/admin/approvals'}
          >
            결재 열기
          </Link>
        )}
        {CANCELLABLE.includes(t.status) && (
          <button type="button" className="ghost" disabled={busy} onClick={cancel}>
            취소
          </button>
        )}
        <Link className="ghost" href="/admin/tasks?ask=1">
          후속 작업
        </Link>
      </div>
    </>
  );
}

function Facts({ task }: { task: TaskDetail }) {
  const { target } = task;
  return (
    <dl className="kv">
      <dt>대상</dt>
      <dd>
        {target ? (
          <>
            {TARGET_LABELS[target.kind] ?? target.kind} ·{' '}
            {target.kind === 'post' ? (
              <Link href={`/admin/posts/${target.id}`}>{target.id}</Link>
            ) : (
              target.id
            )}
            {target.version === null ? '' : ` · 버전 ${target.version}`}
          </>
        ) : (
          '없음'
        )}
      </dd>
      <dt>시도</dt>
      <dd>{task.attempts}회</dd>
      {task.finishedAt && (
        <>
          <dt>끝남</dt>
          <dd>{when(task.finishedAt)}</dd>
        </>
      )}
    </dl>
  );
}

/** 결과는 러너가 정하는 자유 형식이라 그대로 보인다. 실패 이유만 따로 */
function Result({ result }: { result: unknown }) {
  if (typeof result !== 'object' || result === null || Object.keys(result).length === 0)
    return null;
  const { error, ...rest } = result as Record<string, unknown>;
  return (
    <section className="panel" aria-labelledby="task-result">
      <h2 id="task-result">결과</h2>
      {typeof error === 'string' && <p className="error">{error}</p>}
      {Object.keys(rest).length > 0 && <pre className="raw">{JSON.stringify(rest, null, 2)}</pre>}
    </section>
  );
}

/** 맨 아래를 보고 있으면 새 줄을 따라가고, 위로 올려 읽는 중이면 그대로 둔다 */
function Log({ status, events }: { status: string; events: readonly TaskEvent[] }) {
  const box = useRef<HTMLOListElement>(null);
  const following = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 줄이 늘 때마다 맨 아래로 간다
  useEffect(() => {
    if (following.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [events.length]);

  if (events.length === 0)
    return <p className="note">{status === 'queued' ? '러너 배정 대기' : '로그 없음'}</p>;

  return (
    <>
      {events.length >= EVENTS_MAX && <p className="note">최근 {EVENTS_MAX}줄</p>}
      <ol
        ref={box}
        className="log"
        role="log"
        aria-label="실행 로그"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 스크롤되는 영역은 키보드로도 움직일 수 있어야 한다
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {events.map((e) => (
          <li key={e.id}>
            <time dateTime={e.at} title={new Date(e.at).toLocaleString('ko-KR')}>
              {clock(e.at)}
            </time>
            <span className={e.kind === 'result' || e.kind === 'error' ? 'k q' : 'k'}>
              {EVENT_KINDS[e.kind] ?? e.kind}
            </span>
            <span>{e.body || (e.kind === 'result' ? '작업 완료' : '')}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
