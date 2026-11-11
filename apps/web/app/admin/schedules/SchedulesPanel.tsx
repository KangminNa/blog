'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { scheduleLabel, when } from '../../_task/labels';
import { useAgents } from '../../_task/live';
import type { Schedule, ScheduleList, Task } from '../../_task/types';
import { useNotify } from '../AdminShell';
import { ScheduleForm } from './ScheduleForm';

const NEW = 'new';

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
  const notify = useNotify();
  const agents = useAgents();
  const [list, setList] = useState<readonly Schedule[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const agentList = agents.data?.agents ?? [];
  const filtered = agentList.find((a) => a.id === agentId) ?? null;

  const load = useCallback(async () => {
    const query = agentId ? `?agentId=${agentId}` : '';
    const reply = await api<ScheduleList>('GET', `/api/schedules${query}`);
    if (!reply.ok) return setProblem(describe(reply.error));
    setList(reply.data.schedules);
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saved(message: string) {
    setOpen(null);
    notify(message);
    await Promise.all([load(), agents.reload()]);
  }

  async function runNow(s: Schedule) {
    setBusy(s.id);
    setProblem(null);
    const reply = await api<Task>('POST', `/api/schedules/${s.id}/run`, { version: s.version });
    setBusy(null);
    if (!reply.ok) {
      await load();
      return setProblem(
        reply.status === 409 ? '이미 바뀐 스케줄이에요. 다시 읽었어요' : describe(reply.error),
      );
    }
    notify(`${s.title} 작업을 만들었어요`);
    await load();
  }

  async function remove(s: Schedule) {
    if (!window.confirm(`${s.title} 스케줄을 지울까요? 이미 만든 작업은 남아요`)) return;
    setBusy(s.id);
    const reply = await api('POST', `/api/schedules/${s.id}/delete`, { version: s.version });
    setBusy(null);
    if (!reply.ok) {
      await load();
      return setProblem(
        reply.status === 409 ? '이미 바뀐 스케줄이에요. 다시 읽었어요' : describe(reply.error),
      );
    }
    notify(`${s.title} 지움`);
    await Promise.all([load(), agents.reload()]);
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
          onSaved={saved}
          onClose={() => setOpen(null)}
          reload={load}
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
                  onSaved={saved}
                  onClose={() => setOpen(null)}
                  reload={load}
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
                    disabled={busy === s.id}
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
                    disabled={busy === s.id}
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
