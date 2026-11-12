'use client';

import Link from 'next/link';
import { type FormEvent, useId, useRef, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { flatTree, GOAL_STATUS, when } from '../../_task/labels';
import { TASK_TOPICS, useGoals } from '../../_task/live';
import { TaskPill } from '../../_task/parts';
import type { Goal, TaskPage } from '../../_task/types';

/** 열린 입력 칸: 맨 위 목표 추가, 하위 목표 추가(부모 id), 편집(목표 id) */
type Open = { kind: 'add'; parentId: string | null } | { kind: 'edit'; id: string } | null;
/** 저장할 때 보내는 본문 (POST · PATCH /api/goals). 부모 · requestId · version은 패널이 붙인다 */
type GoalBody = { title: string; description: string };

// 목표: 회사 목표부터 이어지는 나무와 목표별 작업. 목표를 정하는 건 주인만, 에이전트는 작업의 목표 사슬로 읽는다.
export function GoalPanel() {
  const goals = useGoals();
  const [open, setOpen] = useState<Open>(null);
  const [tasksOf, setTasksOf] = useState<string | null>(null);
  const action = useAction();
  const save = useAction();
  const list = goals.data?.goals;
  const rows = list ? flatTree(list, (g) => g.parentId) : [];
  const problem = goals.error ?? action.problem;
  const parent = open?.kind === 'add' ? (list?.find((g) => g.id === open.parentId) ?? null) : null;

  const move = (goal: Goal, status: string) =>
    action.run(
      goal.id,
      () => api('POST', `/api/goals/${goal.id}/status`, { status, version: goal.version }),
      {
        done: `${goal.title}: ${GOAL_STATUS[status]}`,
        reload: goals.reload,
        conflict: '이미 바뀐 목표예요. 최신 내용을 다시 읽었어요',
      },
    );

  /** 입력 칸을 열거나 닫는다. 앞 폼의 오류 문구는 남기지 않는다 */
  function show(next: Open) {
    setOpen(next);
    save.clear();
  }

  // 저장은 패널이 돌린다 (폼은 칸만). 고치기는 본 version, 만들기는 부모와 폼이 쥔 requestId를 붙인다
  async function submit(goal: Goal | null, body: GoalBody, requestId: string) {
    const reply = await save.run(
      'save',
      () =>
        goal
          ? api('PATCH', `/api/goals/${goal.id}`, { ...body, version: goal.version })
          : api('POST', '/api/goals', { ...body, parentId: parent?.id ?? null, requestId }),
      {
        done: goal ? '목표 저장됨' : '목표 추가됨',
        reload: goals.reload,
        conflict: '이미 바뀐 목표예요. 다시 저장하면 입력한 내용으로 덮어요',
      },
    );
    if (reply?.ok) setOpen(null);
  }

  return (
    <>
      <header className="page-head">
        <h1>목표</h1>
        {list && list.length > 0 && open?.kind !== 'add' && (
          <button
            type="button"
            className="cta small"
            onClick={() => show({ kind: 'add', parentId: null })}
          >
            목표 추가
          </button>
        )}
      </header>
      {problem && <p className="error">{problem}</p>}
      {open?.kind === 'add' && (
        <GoalForm
          goal={null}
          parent={parent}
          busy={save.busy !== null}
          problem={save.problem}
          onSubmit={(body, requestId) => submit(null, body, requestId)}
          onClose={() => show(null)}
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
              onClick={() => show({ kind: 'add', parentId: null })}
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
                  busy={save.busy !== null}
                  problem={save.problem}
                  onSubmit={(body, requestId) => submit(g, body, requestId)}
                  onClose={() => show(null)}
                />
              ) : (
                <GoalRow
                  goal={g}
                  busy={action.busy === g.id}
                  showingTasks={tasksOf === g.id}
                  onAddChild={() => show({ kind: 'add', parentId: g.id })}
                  onEdit={() => show({ kind: 'edit', id: g.id })}
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

/** 목표 추가 · 편집 폼: 칸과 보낼 본문만 가진다 (저장은 패널). goal이 있으면 편집이다. 부모는 만들 때만 정한다 */
function GoalForm({
  goal,
  parent,
  busy,
  problem,
  onSubmit,
  onClose,
}: {
  goal: Goal | null;
  parent: Goal | null;
  busy: boolean;
  problem: string | null;
  onSubmit: (body: GoalBody, requestId: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  // 같은 내용을 다시 보내면 같은 requestId: 응답을 놓쳐 다시 눌러도 목표는 하나다
  const requestId = useRef<string | null>(null);

  function change(apply: () => void) {
    requestId.current = null;
    apply();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    requestId.current ??= crypto.randomUUID();
    onSubmit({ title: title.trim(), description: description.trim() }, requestId.current);
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
