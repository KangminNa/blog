'use client';

import Link from 'next/link';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { CHECKPOINTS, GOAL_RUN_STATUS, when } from '../../_task/labels';
import { useGoalRun } from '../../_task/live';
import { Criteria, RoundReport } from '../../_task/RoundReport';
import type { GoalRun } from '../../_task/types';

/** 멈출 수 있는 상태 (서버의 GoalRun.stop과 맞춘다) */
const STOPPABLE: readonly string[] = ['running', 'waiting'];

// 목표 실행 하나: 지시 · 완료 조건 · 회차 보고(최근부터). 주인이 할 일은 결재와 멈추기뿐이다.
export function GoalRunPanel({ id }: { id: string }) {
  const run = useGoalRun(id);
  const action = useAction();
  const r = run.data;

  const back = (
    <div>
      <Link className="ghost" href="/admin/goals">
        목표
      </Link>
    </div>
  );

  if (!r)
    return (
      <>
        {back}
        {run.status === 404 ? (
          <p className="rows-empty">찾을 수 없는 목표 실행</p>
        ) : run.error ? (
          <p className="error">{run.error}</p>
        ) : (
          <p className="label-mono">불러오는 중…</p>
        )}
      </>
    );

  const stop = () =>
    action.run(
      'stop',
      () => api<GoalRun>('POST', `/api/goal-runs/${id}/stop`, { version: r.version }),
      {
        done: '목표 실행 멈춤',
        reload: run.reload,
        conflict: '이미 바뀐 목표 실행이에요. 최신 내용을 다시 읽었어요',
      },
    );
  const rounds = [...r.rounds].reverse();

  return (
    <>
      {back}
      <article className="panel" aria-label={r.title}>
        <div className="page-head">
          <div className="page-title">
            <span className="note">목표 실행</span>
            <h2>{r.title}</h2>
          </div>
          <span className={r.status === 'waiting' ? 'pill strong' : 'pill'}>
            {GOAL_RUN_STATUS[r.status] ?? r.status}
          </span>
        </div>
        {r.pendingApprovalId && (
          <div className="row">
            <Link className="cta small" href={`/admin/approvals/${r.pendingApprovalId}`}>
              결재문 보기
            </Link>
          </div>
        )}
        <dl className="kv">
          <dt>목표</dt>
          <dd>{r.goalTitle ?? '–'}</dd>
          <dt>팀장</dt>
          <dd>{r.agentName ?? '–'}</dd>
          <dt>회차</dt>
          <dd>
            {r.round} / 한도 {r.maxRounds}
          </dd>
          <dt>중간 결재</dt>
          <dd>{CHECKPOINTS[r.checkpoint] ?? r.checkpoint}</dd>
          <dt>시작</dt>
          <dd>{when(r.createdAt)}</dd>
          {r.finishedAt && (
            <>
              <dt>끝</dt>
              <dd>{when(r.finishedAt)}</dd>
            </>
          )}
          <dt>지시</dt>
          <dd className="text">{r.instruction}</dd>
        </dl>
        <section className="preview" aria-label="완료 조건">
          <b>완료 조건</b>
          <Criteria criteria={r.criteria} />
        </section>
        {action.problem && <p className="error">{action.problem}</p>}
        {STOPPABLE.includes(r.status) && (
          <div className="row">
            <button
              type="button"
              className="ghost"
              disabled={action.busy !== null}
              onClick={() => void stop()}
            >
              멈추기
            </button>
            <small className="note">도는 회차 작업과 기다리는 결재도 함께 취소해요</small>
          </div>
        )}
      </article>
      <section className="stack" aria-label="회차 보고">
        <h3>회차 보고</h3>
        {r.status === 'running' && (
          <p className="note">{r.round}회차 진행 중. 팀장이 보고하면 여기에 보여요</p>
        )}
        {rounds.length === 0 ? (
          r.status !== 'running' && <p className="note">보고 없음</p>
        ) : (
          <ul className="list" aria-label="회차 보고 목록">
            {rounds.map((round) => (
              <li key={round.round} className="panel">
                <b>
                  {round.round}회차{round.done ? ' · 다 됐다고 보고' : ''}
                </b>
                <RoundReport round={round} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
