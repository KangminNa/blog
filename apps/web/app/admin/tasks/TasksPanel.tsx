'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { type ApiReply, api } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';
import { AskForm } from '../../_task/AskForm';
import { TASK_STATUS, when } from '../../_task/labels';
import { countOf, readPages, TASK_LOG_TOPICS, useAgents } from '../../_task/live';
import { TaskPill } from '../../_task/parts';
import type { Agent, Task, TaskPage } from '../../_task/types';
import { useNotify } from '../../_ui/notify';

/** 보드의 칸. 끝난 작업은 완료 칸에 모은다 */
const COLUMNS = [
  { name: '대기', statuses: ['queued'] },
  { name: '실행 중', statuses: ['running'] },
  { name: '결재 대기', statuses: ['waiting'] },
  { name: '완료', statuses: ['done', 'failed', 'cancelled'] },
];
/** 칸에 펼쳐 두는 수. 나머지는 상태별 목록에서 본다 */
const SHOWN = 10;

type Board = Record<string, TaskPage>;

async function readBoard(): Promise<ApiReply<Board>> {
  const statuses = COLUMNS.flatMap((c) => c.statuses);
  const replies = await Promise.all(
    statuses.map((s) => api<TaskPage>('GET', `/api/tasks?status=${s}`)),
  );
  const board: Board = {};
  for (const [i, reply] of replies.entries()) {
    if (!reply.ok) return reply;
    board[statuses[i] as string] = reply.data;
  }
  return { ok: true, data: board };
}

function mergePages(before: TaskPage, more: TaskPage): TaskPage {
  return { ...more, tasks: [...before.tasks, ...more.tasks] };
}

// 작업: 입력과 보드. 칸 머리를 누르면 상태별 목록, 카드를 누르면 상세(/admin/tasks/<id>)로.
export function TasksPanel({ status, ask }: { status: string | null; ask: boolean }) {
  const notify = useNotify();
  const agents = useAgents();
  const filter = status && status in TASK_STATUS ? status : null;
  const list = agents.data?.agents ?? [];

  return (
    <>
      <AskForm
        agents={agents.data?.agents ?? null}
        focus={ask}
        onCreated={() => notify('작업 등록됨')}
      />
      {filter ? (
        <>
          <nav className="chips" aria-label="작업 상태">
            <Link className="chip" href="/admin/tasks">
              보드
            </Link>
            {Object.keys(TASK_STATUS).map((s) => (
              <Link
                key={s}
                className="chip"
                href={`/admin/tasks?status=${s}`}
                aria-current={filter === s ? 'true' : undefined}
              >
                {TASK_STATUS[s]}
              </Link>
            ))}
          </nav>
          <TaskList key={filter} filter={filter} agents={list} />
        </>
      ) : (
        <TaskBoard agents={list} />
      )}
    </>
  );
}

function TaskBoard({ agents }: { agents: readonly Agent[] }) {
  const board = useLiveValue('tasks:board', readBoard, TASK_LOG_TOPICS);
  const nameOf = (id: string | null) => agents.find((a) => a.id === id)?.name;

  if (board.data === null)
    return board.error ? (
      <p className="error">{board.error}</p>
    ) : (
      <p className="label-mono">불러오는 중…</p>
    );
  const pages = board.data;

  return (
    <>
      {board.error && <p className="error">{board.error}</p>}
      <div className="board">
        {COLUMNS.map((column) => {
          const shown = column.statuses.map((s) => pages[s]);
          const tasks = shown.flatMap((p) => p?.tasks ?? []).sort((a, b) => (a.id < b.id ? 1 : -1));
          const more = shown.find((p) => p?.next)?.next;
          return (
            <section key={column.name} className="col" aria-label={column.name}>
              <Link className="col-head" href={`/admin/tasks?status=${column.statuses[0]}`}>
                <span>{column.name}</span>
                <span>{countOf(tasks, more)}</span>
              </Link>
              {tasks.length === 0 ? (
                <p className="rows-empty">없음</p>
              ) : (
                tasks
                  .slice(0, SHOWN)
                  .map((t) => <TaskCard key={t.id} task={t} agent={nameOf(t.agentId)} />)
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function TaskCard({ task, agent }: { task: Task; agent: string | undefined }) {
  // 끝난 상태와, 결재가 아니라 하위 작업을 기다리는 카드는 상태를 따로 보인다
  const marked =
    task.status === 'failed' || task.status === 'cancelled' || task.waitReason === 'subtasks';
  return (
    <Link
      className={task.status === 'waiting' ? 't-card wait' : 't-card'}
      href={`/admin/tasks/${task.id}`}
    >
      <b>{task.title}</b>
      <span className="t-who">
        {task.status === 'running' && <span className="dot run" aria-hidden="true" />}
        {agent ?? '자동 배정'}
      </span>
      <small>
        {task.lastEvent ?? (task.status === 'queued' ? '러너 배정 대기' : when(task.createdAt))}
      </small>
      {marked && <TaskPill status={task.status} waitReason={task.waitReason} />}
    </Link>
  );
}

/** 거르는 상태마다 따로 둔다: 바꾸면 읽은 쪽 수가 처음으로 돌아간다 */
function TaskList({ filter, agents }: { filter: string; agents: readonly Agent[] }) {
  const pages = useRef(1);
  const list = useLiveValue(
    `tasks:${filter}`,
    () => readPages(`/api/tasks?status=${filter}`, pages.current, mergePages),
    TASK_LOG_TOPICS,
  );
  const nameOf = (id: string | null) => agents.find((a) => a.id === id)?.name ?? '자동 배정';

  return (
    <>
      {list.error && <p className="error">{list.error}</p>}
      {list.data === null ? (
        !list.error && <p className="label-mono">불러오는 중…</p>
      ) : list.data.tasks.length === 0 ? (
        <p className="rows-empty">{TASK_STATUS[filter]} 작업 없음</p>
      ) : (
        <ul className="list">
          {list.data.tasks.map((t) => (
            <li key={t.id}>
              <Link className="item" href={`/admin/tasks/${t.id}`}>
                <div className="item-main">
                  <b>{t.title}</b>
                  <small>
                    {nameOf(t.agentId)} · {when(t.createdAt)}
                  </small>
                </div>
                <TaskPill status={t.status} waitReason={t.waitReason} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.data?.next && (
        <button
          type="button"
          className="ghost wide"
          onClick={() => {
            pages.current += 1;
            void list.reload();
          }}
        >
          더 보기
        </button>
      )}
    </>
  );
}
