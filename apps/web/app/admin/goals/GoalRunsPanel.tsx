'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { CHECKPOINTS, GOAL_RUN_STATUS, when } from '../../_task/labels';
import { useAgents, useGoalRuns, useGoals } from '../../_task/live';
import type { GoalRun } from '../../_task/types';
import { type GoalRunBody, GoalRunForm } from './GoalRunForm';

/** 상태마다 알약의 모양: 결재를 기다리면 채움, 끝났으면 흐리게 */
const PILLS: Record<string, string> = {
  running: 'pill',
  waiting: 'pill strong',
  done: 'pill',
  stopped: 'pill off',
};

// 목표 실행: 목표를 이룰 때까지 팀장 에이전트에게 맡긴다. 회차는 저절로 이어 돌고 주인은 결재문만 받는다.
export function GoalRunsPanel() {
  const runs = useGoalRuns();
  const goals = useGoals();
  const agents = useAgents();
  const [open, setOpen] = useState(false);
  const start = useAction();
  const list = runs.data?.runs;
  const activeGoals = goals.data?.goals.filter((g) => g.status === 'active') ?? [];
  const leads = agents.data?.agents.filter((a) => a.status !== 'paused') ?? [];
  const ready = activeGoals.length > 0 && leads.length > 0;

  async function submit(body: GoalRunBody, requestId: string) {
    const reply = await start.run(
      'start',
      () => api<GoalRun>('POST', '/api/goal-runs', { ...body, requestId }),
      { done: '목표 실행 시작됨', reload: runs.reload },
    );
    if (reply?.ok) setOpen(false);
  }

  return (
    <section className="stack" aria-label="목표 실행">
      <header className="page-head">
        <h2>목표 실행</h2>
        {ready && !open && (
          <button
            type="button"
            className="cta small"
            onClick={() => {
              start.clear();
              setOpen(true);
            }}
          >
            목표 달성까지 맡기기
          </button>
        )}
      </header>
      {runs.error && <p className="error">{runs.error}</p>}
      {!ready && goals.data && agents.data && (
        <p className="note">진행 중인 목표와 멈추지 않은 에이전트가 있어야 맡길 수 있어요</p>
      )}
      {open && (
        <GoalRunForm
          goals={activeGoals}
          agents={leads}
          busy={start.busy !== null}
          problem={start.problem}
          onSubmit={submit}
          onClose={() => setOpen(false)}
        />
      )}
      {list === undefined ? (
        !runs.error && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="note">
          맡긴 목표 실행 없음. 팀장이 회차마다 보고하고, 정한 때와 끝에 결재가 와요
        </p>
      ) : (
        <ul className="list" aria-label="목표 실행 목록">
          {list.map((r) => (
            <li key={r.id}>
              <Link className="item" href={`/admin/goals/runs/${r.id}`}>
                <div className="item-main">
                  <b>{r.title}</b>
                  <small>
                    {r.goalTitle ?? '목표'} · 팀장 {r.agentName ?? '–'} · {r.round}/{r.maxRounds}
                    회차 · 결재 {CHECKPOINTS[r.checkpoint] ?? r.checkpoint} · {when(r.createdAt)}
                  </small>
                </div>
                <span className={PILLS[r.status] ?? 'pill'}>
                  {GOAL_RUN_STATUS[r.status] ?? r.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
