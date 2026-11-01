'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { useLiveValue } from '../../_lib/use-live';
import { AskForm } from '../../_task/AskForm';
import { TASK_STATUS, when } from '../../_task/labels';
import { readPages, TASK_TOPICS, useAgents } from '../../_task/live';
import { TaskPill } from '../../_task/parts';
import type { Agent, TaskPage } from '../../_task/types';
import { useNotify } from '../AdminShell';

const FILTERS: readonly (string | null)[] = [null, ...Object.keys(TASK_STATUS)];

function mergePages(before: TaskPage, more: TaskPage): TaskPage {
  return { ...more, tasks: [...before.tasks, ...more.tasks] };
}

// 작업: 입력, 상태 거르기, 최근 순 목록. 줄을 누르면 상세(/admin/tasks/<id>)로.
export function TasksPanel({ status }: { status: string | null }) {
  const notify = useNotify();
  const agents = useAgents();
  const filter = status && status in TASK_STATUS ? status : null;

  return (
    <>
      <AskForm agents={agents.data?.agents ?? null} onCreated={() => notify('작업 등록됨')} />
      <nav className="chips" aria-label="작업 상태">
        {FILTERS.map((s) => (
          <Link
            key={s ?? 'all'}
            className="chip"
            href={s ? `/admin/tasks?status=${s}` : '/admin/tasks'}
            aria-current={filter === s ? 'true' : undefined}
          >
            {s ? TASK_STATUS[s] : '전체'}
          </Link>
        ))}
      </nav>
      <TaskList key={filter ?? 'all'} filter={filter} agents={agents.data?.agents ?? []} />
    </>
  );
}

/** 거르는 상태마다 따로 둔다: 바꾸면 읽은 쪽 수가 처음으로 돌아간다 */
function TaskList({ filter, agents }: { filter: string | null; agents: readonly Agent[] }) {
  const pages = useRef(1);
  const list = useLiveValue(
    `tasks:${filter ?? 'all'}`,
    () =>
      readPages(filter ? `/api/tasks?status=${filter}` : '/api/tasks', pages.current, mergePages),
    TASK_TOPICS,
  );
  const nameOf = (id: string | null) => agents.find((a) => a.id === id)?.name ?? '자동 배정';

  return (
    <>
      {list.error && <p className="error">{list.error}</p>}
      {list.data === null ? (
        !list.error && <p className="label-mono">불러오는 중…</p>
      ) : list.data.tasks.length === 0 ? (
        <p className="rows-empty">
          {filter ? `${TASK_STATUS[filter]} 작업 없음` : '작업 없음. 위 입력란에서 작업을 등록해요'}
        </p>
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
                <TaskPill status={t.status} />
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
