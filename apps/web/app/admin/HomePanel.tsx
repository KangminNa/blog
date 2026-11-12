'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AskForm } from '../_task/AskForm';
import { actionLabel, holdLabel, when } from '../_task/labels';
import { countOf, useAgents, usePendingApprovals, useTasksIn, useUsage } from '../_task/live';
import { AgentUsage, ApprovalPill, TaskPill } from '../_task/parts';
import type { Agent, Task } from '../_task/types';
import { UsageBlock } from '../_task/UsageBlock';
import { useNotify } from '../_ui/notify';

/** 홈에 펼쳐 두는 줄 수. 나머지는 각 메뉴에서 본다 */
const SHOWN = 4;

// 홈: 작업 입력, 그리고 지금 봐야 할 것 (결재 대기, 실행 중, 사용량, 에이전트).
export function HomePanel() {
  const router = useRouter();
  const notify = useNotify();
  const approvals = usePendingApprovals();
  const running = useTasksIn('running');
  const queued = useTasksIn('queued');
  const agents = useAgents();
  const usage = useUsage();
  const [today, setToday] = useState('');

  // 서버와 브라우저의 시간대가 다를 수 있어 브라우저에서 정한다
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }),
    );
  }, []);

  const names = useMemo(
    () => new Map(agents.data?.agents.map((a) => [a.id, a.name]) ?? []),
    [agents.data],
  );
  const agentList = agents.data?.agents;
  const active = agentList?.filter((a) => a.status === 'active') ?? [];
  const pending = approvals.data?.approvals ?? [];
  const live = [...(running.data?.tasks ?? []), ...(queued.data?.tasks ?? [])];
  // 에이전트가 하나도 없을 때는 입력란과 아래 칸이 알려 준다. 여기는 모두 중지된 경우
  const stuck = agentList?.length && active.length === 0 && queued.data?.tasks.length;
  const error = approvals.error ?? running.error ?? queued.error ?? agents.error ?? usage.error;

  return (
    <section className="console-inner wide" aria-label="홈">
      <header className="page-head">
        <div>
          <h1>홈</h1>
          <p>{today || ' '}</p>
        </div>
      </header>
      <AskForm
        agents={agentList ?? null}
        onCreated={(task) => {
          notify('작업 등록됨');
          // 페이지로 받는 일은 페이지 메뉴에서 기다린다: 끝나면 그 페이지가 열린다
          router.push(task.page ? `/admin/pages?task=${task.id}` : `/admin/tasks/${task.id}`);
        }}
      />
      {error && <p className="error">{error}</p>}
      {stuck ? (
        <p className="warn">
          대기 작업 {queued.data?.tasks.length}건. 활성 에이전트가 있어야 실행돼요{' · '}
          <Link href="/admin/agents">에이전트 열기</Link>
        </p>
      ) : null}
      <div className="stats">
        <Link className="stat" href="/admin/approvals">
          <b>{countOf(approvals.data?.approvals, approvals.data?.next)}</b>
          <small>결재 대기</small>
        </Link>
        <Link className="stat" href="/admin/tasks?status=running">
          <b>{countOf(running.data?.tasks, running.data?.next)}</b>
          <small>실행 중</small>
        </Link>
        <Link className="stat" href="/admin/tasks?status=queued">
          <b>{countOf(queued.data?.tasks, queued.data?.next)}</b>
          <small>작업 대기</small>
        </Link>
        <Link className="stat" href="/admin/agents">
          <b>{agentList ? active.length : '–'}</b>
          <small>활성 에이전트</small>
        </Link>
      </div>
      <div className="two">
        <section aria-labelledby="home-approvals">
          <div className="sec-title">
            <h2 id="home-approvals">결재 대기</h2>
            <Link href="/admin/approvals">전체 보기</Link>
          </div>
          {pending.length === 0 ? (
            <p className="rows-empty">{approvals.data ? '대기 중인 결재 없음' : '불러오는 중…'}</p>
          ) : (
            <ul className="list">
              {pending.slice(0, SHOWN).map((a) => (
                <li key={a.id}>
                  <Link className="item" href={`/admin/approvals/${a.id}`}>
                    <div className="item-main">
                      <b>{actionLabel(a.action)}</b>
                      <small>
                        {names.get(a.agentId ?? '') ?? '서버'} · {when(a.createdAt)}
                      </small>
                    </div>
                    <ApprovalPill status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="home-running">
          <div className="sec-title">
            <h2 id="home-running">실행 중</h2>
            <Link href="/admin/tasks">전체 보기</Link>
          </div>
          {live.length === 0 ? (
            <p className="rows-empty">{running.data ? '실행 중인 작업 없음' : '불러오는 중…'}</p>
          ) : (
            <ul className="list">
              {live.slice(0, SHOWN).map((t) => (
                <TaskRow key={t.id} task={t} agent={names.get(t.agentId ?? '')} />
              ))}
            </ul>
          )}
        </section>
      </div>
      <UsageBlock usage={usage.data} agents={agentList} />
      <section aria-labelledby="home-agents">
        <div className="sec-title">
          <h2 id="home-agents">에이전트</h2>
          <Link href="/admin/agents">전체 보기</Link>
        </div>
        {agentList === undefined ? (
          <p className="rows-empty">불러오는 중…</p>
        ) : agentList.length === 0 ? (
          <div className="panel">
            <b>에이전트 없음</b>
            <p className="note">추가하면 대기 작업부터 실행</p>
            <Link className="cta small fit" href="/admin/agents?new=1">
              에이전트 추가
            </Link>
          </div>
        ) : (
          <ul className="list">
            {agentList.map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                hold={holdLabel(usage.data?.agents.find((u) => u.id === a.id))}
              />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function TaskRow({ task, agent }: { task: Task; agent: string | undefined }) {
  return (
    <li>
      <Link className="item" href={`/admin/tasks/${task.id}`}>
        <div className="item-main">
          <b>{task.title}</b>
          <small>
            {agent ?? '자동 배정'} · {task.lastEvent ?? when(task.createdAt)}
          </small>
        </div>
        <TaskPill status={task.status} waitReason={task.waitReason} />
      </Link>
    </li>
  );
}

function AgentRow({ agent, hold }: { agent: Agent; hold: string | null }) {
  return (
    <li>
      <Link className="item" href="/admin/agents">
        <div className="item-main">
          <b>{agent.name}</b>
          <AgentUsage agent={agent} />
        </div>
        {agent.status === 'paused' ? (
          <span className="pill off">중지</span>
        ) : (
          hold && <span className="pill strong">{hold}</span>
        )}
      </Link>
    </li>
  );
}
