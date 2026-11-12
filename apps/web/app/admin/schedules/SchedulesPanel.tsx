'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { scheduleLabel, when } from '../../_task/labels';
import { useAgents, useSchedules } from '../../_task/live';
import type { Schedule, Task } from '../../_task/types';
import { type ScheduleBody, ScheduleForm } from './ScheduleForm';

const NEW = 'new';
const CONFLICT = '이미 바뀐 스케줄이에요. 최신 내용을 다시 읽었어요';

/** 오늘(스케줄의 시간대 기준) 만든 작업 수 */
function todayRuns(s: Schedule): number {
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: s.timeZone }).format(new Date());
    return s.runDay === today ? s.dayRuns : 0;
  } catch {
    return 0;
  }
}

// 스케줄: 정한 시각에 지시대로 작업을 만든다 (하트비트를 넓힌 것). 만들기 · 고치기 · 지금 한 번 · 지우기.
// 에이전트 화면에서 오면 그 에이전트가 담당인 것만 (주소의 agent).
export function SchedulesPanel({ agentId }: { agentId: string | null }) {
  const agents = useAgents();
  const schedules = useSchedules(agentId);
  const action = useAction();
  const save = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const list = schedules.data?.schedules ?? null;
  const problem = action.problem ?? schedules.error;
  const agentList = agents.data?.agents ?? [];
  const filtered = agentList.find((a) => a.id === agentId) ?? null;
  const reload = () => Promise.all([schedules.reload(), agents.reload()]);

  function close() {
    setOpen(null);
    save.clear();
  }

  // 저장은 패널이 돌린다 (폼은 칸만). 고치기는 본 version, 만들기는 폼이 쥔 requestId를 붙인다
  async function submit(target: Schedule | null, body: ScheduleBody, requestId: string) {
    const reply = await save.run(
      'save',
      () =>
        target
          ? api('PATCH', `/api/schedules/${target.id}`, { ...body, version: target.version })
          : api('POST', '/api/schedules', { ...body, requestId }),
      { done: `${body.title} ${body.enabled ? '켜짐' : '꺼짐'}`, reload, conflict: CONFLICT },
    );
    if (reply?.ok) setOpen(null);
    return reply?.ok === true;
  }

  const runNow = (s: Schedule) =>
    action.run(
      s.id,
      () => api<Task>('POST', `/api/schedules/${s.id}/run`, { version: s.version }),
      { done: `${s.title} 작업을 만들었어요`, reload: schedules.reload, conflict: CONFLICT },
    );

  function remove(s: Schedule) {
    if (!window.confirm(`${s.title} 스케줄을 지울까요? 이미 만든 작업은 남아요`)) return;
    void action.run(
      s.id,
      () => api('POST', `/api/schedules/${s.id}/delete`, { version: s.version }),
      { done: `${s.title} 지움`, reload, conflict: CONFLICT },
    );
  }

  return (
    <>
      <header className="page-head">
        <h1>스케줄</h1>
        {open !== NEW && (
          <button type="button" className="cta small" onClick={() => setOpen(NEW)}>
            만들기
          </button>
        )}
      </header>
      <p className="note">
        정한 시각에 지시대로 작업을 만들어요. 앞 작업이 끝나지 않았거나 담당이 쉬면 그 차례는
        건너뛰고, 하루 한도에 닿으면 그날은 더 만들지 않아요
      </p>
      {agentId && (
        <p className="note">
          {filtered?.name ?? '에이전트'} 담당만 보는 중 ·{' '}
          <Link href="/admin/schedules">전체 보기</Link>
        </p>
      )}
      {problem && <p className="error">{problem}</p>}
      {open === NEW && (
        <ScheduleForm
          schedule={null}
          agents={agentList}
          agentId={agentId}
          busy={save.busy !== null}
          problem={save.problem}
          onSubmit={(body, requestId) => submit(null, body, requestId)}
          onEdit={save.clear}
          onClose={close}
        />
      )}
      {list === null ? (
        !problem && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rows-empty">스케줄 없음</p>
      ) : (
        <ul className="list" aria-label="스케줄">
          {list.map((s) =>
            open === s.id ? (
              <li key={s.id} className="list-cell">
                <ScheduleForm
                  schedule={s}
                  agents={agentList}
                  agentId={null}
                  busy={save.busy !== null}
                  problem={save.problem}
                  onSubmit={(body, requestId) => submit(s, body, requestId)}
                  onEdit={save.clear}
                  onClose={close}
                />
              </li>
            ) : (
              <li key={s.id} className="list-cell schedule-row">
                <div className="item-main">
                  <b>{s.title}</b>
                  <small>
                    {scheduleLabel(s)} ·{' '}
                    {agentList.find((a) => a.id === s.agentId)?.name ?? '자동 배정'} · 오늘{' '}
                    {todayRuns(s)}/{s.dailyMax}
                    {s.nextRunAt ? ` · 다음 ${when(s.nextRunAt)}` : ''}
                  </small>
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="ghost"
                    disabled={action.busy === s.id}
                    onClick={() => runNow(s)}
                  >
                    지금 한 번
                  </button>
                  <button type="button" className="ghost" onClick={() => setOpen(s.id)}>
                    고치기
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={action.busy === s.id}
                    onClick={() => remove(s)}
                  >
                    지우기
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}
