'use client';

import Link from 'next/link';
import { type FormEvent, useId, useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';
import { flatTree, GOAL_STATUS, when } from '../../_task/labels';
import { TASK_TOPICS, useGoals } from '../../_task/live';
import { TaskPill } from '../../_task/parts';
import type { Goal, TaskPage } from '../../_task/types';
import { useNotify } from '../AdminShell';

/** 열린 입력 칸: 맨 위 목표 추가, 하위 목표 추가(부모 id), 편집(목표 id) */
type Open = { kind: 'add'; parentId: string | null } | { kind: 'edit'; id: string } | null;

// 목표: 회사 목표부터 이어지는 나무와 목표별 작업. 목표를 정하는 건 주인만, 에이전트는 작업의 목표 사슬로 읽는다.
export function GoalPanel() {
  const notify = useNotify();
  const goals = useGoals();
  const [open, setOpen] = useState<Open>(null);
  const [tasksOf, setTasksOf] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const list = goals.data?.goals;
  const rows = list ? flatTree(list, (g) => g.parentId) : [];

  async function move(goal: Goal, status: string) {
    setBusy(goal.id);
    setProblem(null);
    const reply = await api('POST', `/api/goals/${goal.id}/status`, {
      status,
      version: goal.version,
    });
    await goals.reload();
    setBusy(null);
    if (reply.ok) return notify(`${goal.title}: ${GOAL_STATUS[status]}`);
    setProblem(
      reply.status === 409
        ? '이미 바뀐 목표예요. 최신 내용을 다시 읽었어요'
        : describe(reply.error),
    );
  }

  async function saved(text: string) {
    setOpen(null);
    notify(text);
    await goals.reload();
  }

  return (
    <>
      <header className="page-head">
        <h1>목표</h1>
        {list && list.length > 0 && open?.kind !== 'add' && (
          <button
            type="button"
            className="cta small"
            onClick={() => setOpen({ kind: 'add', parentId: null })}
          >
            목표 추가
          </button>
        )}
      </header>
      {(goals.error ?? problem) && <p className="error">{goals.error ?? problem}</p>}
      {open?.kind === 'add' && (
        <GoalForm
          goal={null}
          parent={list?.find((g) => g.id === open.parentId) ?? null}
          onSaved={saved}
          onClose={() => setOpen(null)}
          reload={goals.reload}
        />
      )}
      {list === undefined ? (
        !goals.error && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        open === null && (
          <div className="panel">
            <b>목표 없음</b>
            <p className="note">
              맨 위에 회사 목표를 두고 아래로 나눠요. 작업을 맡길 때 목표를 고르면 에이전트가 목표의
              사슬을 함께 받아요
            </p>
            <button
              type="button"
              className="cta small fit"
              onClick={() => setOpen({ kind: 'add', parentId: null })}
            >
              목표 추가
            </button>
          </div>
        )
      ) : (
        <ul className="list" aria-label="목표 나무">
          {rows.map(({ item: g, depth }) => (
            <li key={g.id} style={{ paddingLeft: depth * 20 }}>
              {open?.kind === 'edit' && open.id === g.id ? (
                <GoalForm
                  goal={g}
                  parent={null}
                  onSaved={saved}
                  onClose={() => setOpen(null)}
                  reload={goals.reload}
                />
              ) : (
                <GoalRow
                  goal={g}
                  busy={busy === g.id}
                  showingTasks={tasksOf === g.id}
                  onAddChild={() => setOpen({ kind: 'add', parentId: g.id })}
                  onEdit={() => setOpen({ kind: 'edit', id: g.id })}
                  onMove={(status) => move(g, status)}
                  onTasks={() => setTasksOf(tasksOf === g.id ? null : g.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function GoalRow({
  goal,
  busy,
  showingTasks,
  onAddChild,
  onEdit,
  onMove,
  onTasks,
}: {
  goal: Goal;
  busy: boolean;
  showingTasks: boolean;
  onAddChild: () => void;
  onEdit: () => void;
  onMove: (status: string) => void;
  onTasks: () => void;
}) {
  const active = goal.status === 'active';
  return (
    <div className="panel" style={{ border: 0, borderRadius: 0 }}>
      <div className="agent-top">
        <div className="item-main">
          <b>{goal.title}</b>
          <small>
            진행 {goal.openTasks} · 완료 {goal.doneTasks}
            {goal.description ? ` · ${goal.description}` : ''}
          </small>
        </div>
        <span className={active ? 'pill strong' : 'pill off'}>{GOAL_STATUS[goal.status]}</span>
      </div>
      <div className="row">
        <button type="button" className="ghost" onClick={onTasks} aria-expanded={showingTasks}>
          작업
        </button>
        {active && (
          <button type="button" className="ghost" onClick={onAddChild}>
            하위 목표
          </button>
        )}
        <button type="button" className="ghost" onClick={onEdit}>
          편집
        </button>
        {active ? (
          <>
            <button type="button" className="ghost" disabled={busy} onClick={() => onMove('done')}>
              달성
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => onMove('dropped')}
            >
              중단
            </button>
          </>
        ) : (
          <button type="button" className="ghost" disabled={busy} onClick={() => onMove('active')}>
            다시 열기
          </button>
        )}
      </div>
      {showingTasks && <GoalTasks goalId={goal.id} />}
    </div>
  );
}

/** 목표에 이어진 작업의 첫 쪽 */
function GoalTasks({ goalId }: { goalId: string }) {
  const tasks = useLiveValue(
    `tasks:goal:${goalId}`,
    () => api<TaskPage>('GET', `/api/tasks?goalId=${goalId}`),
    TASK_TOPICS,
    goalId,
  );
  if (tasks.error) return <p className="error">{tasks.error}</p>;
  if (tasks.data === null) return <p className="label-mono">불러오는 중…</p>;
  if (tasks.data.tasks.length === 0)
    return <p className="note">이어진 작업 없음. 작업을 맡길 때 이 목표를 고르면 여기에 보여요</p>;
  return (
    <ul className="list" aria-label="이어진 작업">
      {tasks.data.tasks.map((t) => (
        <li key={t.id}>
          <Link className="item" href={`/admin/tasks/${t.id}`}>
            <div className="item-main">
              <b>{t.title}</b>
              <small>{when(t.createdAt)}</small>
            </div>
            <TaskPill status={t.status} waitReason={t.waitReason} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 목표 추가 · 편집. goal이 있으면 편집이다. 부모는 만들 때만 정한다 */
function GoalForm({
  goal,
  parent,
  onSaved,
  onClose,
  reload,
}: {
  goal: Goal | null;
  parent: Goal | null;
  onSaved: (message: string) => void;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const id = useId();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // 같은 내용을 다시 보내면 같은 requestId: 응답을 놓쳐 다시 눌러도 목표는 하나다
  const requestId = useRef<string | null>(null);

  function change(apply: () => void) {
    requestId.current = null;
    apply();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const fields = { title: title.trim(), description: description.trim() };
    requestId.current ??= crypto.randomUUID();
    const reply = goal
      ? await api('PATCH', `/api/goals/${goal.id}`, { ...fields, version: goal.version })
      : await api('POST', '/api/goals', {
          ...fields,
          parentId: parent?.id ?? null,
          requestId: requestId.current,
        });
    setBusy(false);
    if (reply.ok) return onSaved(goal ? '목표 저장됨' : '목표 추가됨');
    if (reply.status === 409) {
      await reload();
      return setProblem('이미 바뀐 목표예요. 다시 저장하면 입력한 내용으로 덮어요');
    }
    setProblem(describe(reply.error));
  }

  const label = goal ? `${goal.title} 편집` : parent ? `${parent.title}의 하위 목표` : '목표 추가';
  return (
    <form className="panel" onSubmit={submit} aria-label={label}>
      {!goal && <b>{parent ? `${parent.title} 아래에 추가` : '맨 위 목표'}</b>}
      <div className="field">
        <label htmlFor={`${id}-title`}>제목</label>
        <input
          id={`${id}-title`}
          className="input"
          value={title}
          maxLength={200}
          required
          onChange={(e) => change(() => setTitle(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-description`}>설명</label>
        <textarea
          id={`${id}-description`}
          className="input"
          rows={2}
          value={description}
          maxLength={4000}
          onChange={(e) => change(() => setDescription(e.target.value))}
        />
        <small>에이전트가 작업과 함께 받아요. 무엇이 되면 달성인지 적어 두면 좋아요</small>
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy || !title.trim()}>
          {goal ? '저장' : '추가'}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
