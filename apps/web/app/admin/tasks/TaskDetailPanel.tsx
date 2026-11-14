'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import {
  bytes,
  CANCELLABLE,
  clock,
  EVENT_KINDS,
  OUTPUT_KINDS,
  TARGET_LABELS,
  tokens,
  when,
} from '../../_task/labels';
import { useAgents, usePendingApprovals } from '../../_task/live';
import { OutputOpen, TaskPill } from '../../_task/parts';
import type { Task, TaskDetail, TaskEvent, TaskOutput, TaskRun } from '../../_task/types';

/** 서버가 상세에 보내는 실행 기록의 최대 개수 (TaskQuery.EVENTS) */
const EVENTS_MAX = 500;
const DETAIL_TOPICS = ['task.task.changed', 'task.event.added'];

// 작업 상세: 지시, 대상, 결과, 실행 로그. 로그는 신호가 올 때마다 다시 읽어 새로 고침 없이 늘어난다.
export function TaskDetailPanel({ id }: { id: string }) {
  const task = useLiveValue(
    `task:${id}`,
    () => api<TaskDetail>('GET', `/api/tasks/${id}`),
    DETAIL_TOPICS,
    id,
  );
  const agents = useAgents();
  const approvals = usePendingApprovals();
  const action = useAction();
  const t = task.data;

  const cancel = (version: number) =>
    action.run('cancel', () => api<Task>('POST', `/api/tasks/${id}/cancel`, { version }), {
      done: '작업 취소됨',
      reload: task.reload,
      conflict: '이미 바뀐 작업이에요. 최신 내용을 다시 읽었어요',
    });

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
        <TaskPill status={t.status} waitReason={t.waitReason} />
      </div>
      {paused && <p className="warn">담당 에이전트 중지됨. 재개하면 실행돼요</p>}
      {t.waitReason === 'subtasks' && (
        <p className="warn">하위 작업을 기다리는 중. 모두 끝나면 결과를 받아 다시 실행돼요</p>
      )}
      {executing && <p className="warn">결재 승인됨. 실행 결과를 기다리는 중</p>}
      <section className="panel" aria-labelledby="task-instruction">
        <h2 id="task-instruction">지시</h2>
        <p className="text">{t.instruction || '지시 없음'}</p>
        <Facts task={t} />
      </section>
      <Result result={t.result} />
      <Outputs taskId={t.id} outputs={t.outputs} />
      {(t.parentId || t.children.length > 0) && (
        <section className="panel" aria-labelledby="task-family">
          <h2 id="task-family">위임</h2>
          {t.parentId && (
            <p className="note">
              맡긴 작업: <Link href={`/admin/tasks/${t.parentId}`}>위 작업 열기</Link>
            </p>
          )}
          {t.children.length > 0 && (
            <ul className="list" aria-label="하위 작업">
              {t.children.map((c) => (
                <li key={c.id}>
                  <Link className="item" href={`/admin/tasks/${c.id}`}>
                    <div className="item-main">
                      <b>{c.title}</b>
                      <small>
                        {agents.data?.agents.find((a) => a.id === c.agentId)?.name ?? '자동 배정'}
                        {c.lastEvent ? ` · ${c.lastEvent}` : ''}
                      </small>
                    </div>
                    <TaskPill status={c.status} waitReason={c.waitReason} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {CANCELLABLE.includes(t.status) && t.children.length > 0 && (
            <p className="note">취소하면 끝나지 않은 하위 작업도 함께 취소돼요</p>
          )}
        </section>
      )}
      <Runs runs={t.runs} />
      <section className="panel" aria-labelledby="task-log">
        <div className="sec-title flat">
          <h2 id="task-log">실행 로그</h2>
          <span className="note">토큰 {tokens(t.events.reduce((n, e) => n + e.tokens, 0))}</span>
        </div>
        <Log status={t.status} events={t.events} />
      </section>
      {action.problem && <p className="error">{action.problem}</p>}
      <div className="row">
        {t.waitReason === 'approval' && (
          <Link
            className="cta small"
            href={approval ? `/admin/approvals/${approval.id}` : '/admin/approvals'}
          >
            결재 열기
          </Link>
        )}
        {CANCELLABLE.includes(t.status) && (
          <button
            type="button"
            className="ghost"
            disabled={action.busy !== null}
            onClick={() => cancel(t.version)}
          >
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
      {task.goalChain.length > 0 && (
        <>
          <dt>목표</dt>
          <dd>
            <Link href="/admin/goals">{task.goalChain.map((g) => g.title).join(' › ')}</Link>
          </dd>
        </>
      )}
      <Materials payload={task.payload} />
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

/** 만들기 작업의 재료 (payload.make): 주인이 고른 결과물 파일과 위키. 이름은 각 메뉴에서 */
function Materials({ payload }: { payload: unknown }) {
  const make = (payload as { make?: { outputs?: unknown; wikis?: unknown } } | null)?.make;
  if (!make) return null;
  const ids = (raw: unknown) =>
    Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  const outputs = ids(make.outputs);
  const wikis = ids(make.wikis);
  return (
    <>
      <dt>재료</dt>
      <dd>
        {outputs.length === 0 && wikis.length === 0 ? '없음' : null}
        {outputs.map((id, i) => (
          <span key={id}>
            <a href={`/api/outputs/${id}/file`}>결과물 {i + 1}</a>{' '}
          </span>
        ))}
        {wikis.map((id, i) => (
          <span key={id}>
            <Link href={`/admin/wiki?wiki=${id}`}>위키 {i + 1}</Link>{' '}
          </span>
        ))}
      </dd>
    </>
  );
}

/** 이 작업이 만든 파일. 미리 보기와 휴지통은 결과물 메뉴에서 */
function Outputs({ taskId, outputs }: { taskId: string; outputs: readonly TaskOutput[] }) {
  if (outputs.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="task-outputs">
      <div className="sec-title flat">
        <h2 id="task-outputs">결과물</h2>
        <Link className="note" href={`/admin/outputs?task=${taskId}`}>
          결과물 메뉴에서 보기
        </Link>
      </div>
      <ul className="list" aria-label="결과물">
        {outputs.map((o) => (
          <li key={o.id} className="list-cell output-row">
            <div className="output-main">
              <b>{o.name}</b>
              <small>
                {OUTPUT_KINDS[o.kind] ?? o.kind} · {bytes(o.sizeBytes)} · {o.runSeq}회
              </small>
            </div>
            <OutputOpen id={o.id} name={o.name} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 실행마다 어떤 규칙으로 돌았는지: 결과가 바뀌었을 때 무엇이 바뀌어서인지 비교한다 */
function Runs({ runs }: { runs: readonly TaskRun[] }) {
  if (runs.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="task-runs">
      <h2 id="task-runs">실행 기록</h2>
      <ol className="list" aria-label="실행">
        {runs.map((r) => (
          <li key={r.seq} className="list-cell stack">
            <div>
              <b>{r.seq}회</b> <span className="label-mono">{when(r.startedAt)}</span>
            </div>
            <dl className="kv">
              {r.agentRevision !== null && (
                <>
                  <dt>에이전트 설정</dt>
                  <dd>버전 {r.agentRevision}</dd>
                </>
              )}
              <dt>스킬</dt>
              <dd>
                {r.skill === null
                  ? '없음'
                  : `${r.skill.name} · ${r.skill.source === 'console' ? `콘솔 버전 ${r.skill.revision}` : '저장소 버전'} · ${(r.skill.hash ?? '').slice(0, 7)}`}
              </dd>
              <dt>러너 빌드</dt>
              <dd>{r.runnerBuild ?? '알 수 없음'}</dd>
              <dt>CLI</dt>
              <dd>{r.cliVersion ?? '알 수 없음'}</dd>
              <dt>모델</dt>
              <dd>{r.model ?? '보고 전'}</dd>
            </dl>
          </li>
        ))}
      </ol>
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
