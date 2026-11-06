'use client';

import { useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { SCOPE_LABELS } from '../../_lib/types';
import {
  actionLabel,
  flatTree,
  heartbeatLabel,
  holdLabel,
  TOOL_LABELS,
  taskStatusLabel,
  when,
} from '../../_task/labels';
import { useAgents, useTasksIn, useUsage } from '../../_task/live';
import { AgentUsage } from '../../_task/parts';
import type { Agent } from '../../_task/types';
import { useNotify } from '../AdminShell';
import { AgentForm } from './AgentForm';
import { HeartbeatForm } from './HeartbeatForm';

const NEW = 'new';
/** 하트비트 입력 칸을 연 에이전트: open에 이 앞부분 + id */
const HEARTBEAT = 'heartbeat:';

// 에이전트: 조직도, 사용량과 한도, 추가, 편집, 중지, 재개.
export function AgentsPanel({ adding }: { adding: boolean }) {
  const notify = useNotify();
  const agents = useAgents();
  const running = useTasksIn('running');
  const waiting = useTasksIn('waiting');
  const usage = useUsage();
  // 열린 입력 칸: 추가, 또는 편집 중인 에이전트의 id
  const [open, setOpen] = useState<string | null>(adding ? NEW : null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = agents.data?.agents;

  /** 실행 중이거나 기다리는 작업이 있으면 그 상태 이름 (결재 · 하위 작업 대기를 나눈다) */
  function workOf(agent: Agent): string | null {
    if (running.data?.tasks.some((t) => t.agentId === agent.id)) return taskStatusLabel('running');
    const waits = waiting.data?.tasks.find((t) => t.agentId === agent.id);
    return waits ? taskStatusLabel(waits.status, waits.waitReason) : null;
  }

  async function flip(agent: Agent) {
    const paused = agent.status === 'paused';
    setBusy(agent.id);
    setProblem(null);
    const reply = await api('POST', `/api/agents/${agent.id}/${paused ? 'resume' : 'pause'}`, {
      version: agent.version,
    });
    await agents.reload();
    setBusy(null);
    if (reply.ok) return notify(`${agent.name} ${paused ? '재개됨' : '중지됨'}`);
    setProblem(
      reply.status === 409
        ? '이미 바뀐 에이전트예요. 최신 내용을 다시 읽었어요'
        : describe(reply.error),
    );
  }

  async function saved(text: string) {
    setOpen(null);
    notify(text);
    // 한도를 바꾸면 쉬는지도 바뀐다. 이 저장에는 사용량 신호가 없다
    await Promise.all([agents.reload(), usage.reload()]);
  }

  return (
    <>
      <header className="page-head">
        <h1>에이전트</h1>
        {list && list.length > 0 && open !== NEW && (
          <button type="button" className="cta small" onClick={() => setOpen(NEW)}>
            에이전트 추가
          </button>
        )}
      </header>
      {(agents.error ?? problem) && <p className="error">{agents.error ?? problem}</p>}
      {list && list.length > 0 && <OrgChart agents={list} />}
      {open === NEW && (
        <AgentForm
          agent={null}
          agents={list ?? []}
          onSaved={saved}
          onClose={() => setOpen(null)}
          reload={agents.reload}
        />
      )}
      {list === undefined ? (
        !agents.error && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        open !== NEW && (
          <div className="panel">
            <b>에이전트 없음</b>
            <p className="note">
              작업은 활성 에이전트가 생길 때까지 대기. 추가하면 대기 작업부터 실행
            </p>
            <button type="button" className="cta small fit" onClick={() => setOpen(NEW)}>
              에이전트 추가
            </button>
          </div>
        )
      ) : (
        <div className="agents">
          {list.map((a) =>
            open === `${HEARTBEAT}${a.id}` ? (
              <HeartbeatForm
                key={a.id}
                agent={a}
                onSaved={saved}
                onClose={() => setOpen(null)}
                reload={agents.reload}
              />
            ) : open === a.id ? (
              <AgentForm
                key={a.id}
                agent={a}
                agents={list}
                onSaved={saved}
                onClose={() => setOpen(null)}
                reload={agents.reload}
              />
            ) : (
              <AgentCard
                key={a.id}
                agent={a}
                work={workOf(a)}
                hold={holdLabel(usage.data?.agents.find((u) => u.id === a.id))}
                boss={list.find((b) => b.id === a.reportsTo)?.name ?? null}
                busy={busy === a.id}
                onFlip={() => flip(a)}
                onEdit={() => setOpen(a.id)}
                onHeartbeat={() => setOpen(`${HEARTBEAT}${a.id}`)}
              />
            ),
          )}
        </div>
      )}
    </>
  );
}

/** 조직도: 맨 위는 주인. 보고 대상이 없는 에이전트는 주인에게 보고한다. 위임은 바로 아래 팀에게만 */
function OrgChart({ agents }: { agents: readonly Agent[] }) {
  const rows = flatTree(agents, (a) => a.reportsTo);
  return (
    <section className="panel" aria-labelledby="org-chart">
      <h2 id="org-chart">조직도</h2>
      <ol className="org" aria-label="보고 순서">
        <li>
          <b>주인</b> <small className="note">결재 · 발행</small>
        </li>
        {rows.map(({ item, depth }) => (
          <li key={item.id} style={{ paddingLeft: (depth + 1) * 20 }}>
            └ {item.name}
            {item.role && <small className="note"> · {item.role.split('\n')[0]}</small>}
            {item.status === 'paused' && <small className="note"> · 중지</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function AgentCard({
  agent,
  work,
  hold,
  boss,
  busy,
  onFlip,
  onEdit,
  onHeartbeat,
}: {
  agent: Agent;
  work: string | null;
  hold: string | null;
  /** 보고 대상의 이름. null이면 주인 */
  boss: string | null;
  busy: boolean;
  onFlip: () => void;
  onEdit: () => void;
  onHeartbeat: () => void;
}) {
  const paused = agent.status === 'paused';
  return (
    <article className="agent" aria-label={agent.name}>
      <div className="agent-top">
        <div className="item-main">
          <b>{agent.name}</b>
          <small>
            {agent.role ? `${agent.role} · ` : ''}
            {TOOL_LABELS[agent.tool] ?? agent.tool} · 보고: {boss ?? '주인'}
          </small>
        </div>
        {!paused && hold && <span className="pill strong">{hold}</span>}
        {(paused || work || !hold) && (
          <span className={paused ? 'pill off' : work ? 'pill on' : 'pill'}>
            {paused ? '중지' : (work ?? '대기')}
          </span>
        )}
      </div>
      <ul className="perm" aria-label="권한">
        {agent.scopes.map((s) => (
          <li key={s}>{SCOPE_LABELS[s] ?? s}</li>
        ))}
        {agent.approvalActions.map((a) => (
          <li key={a} className="gate">
            {actionLabel(a)}: 결재 필요
          </li>
        ))}
        {agent.scopes.length === 0 && agent.approvalActions.length === 0 && <li>권한 없음</li>}
      </ul>
      <AgentUsage agent={agent} />
      <p className="note">
        하트비트: {heartbeatLabel(agent.heartbeat)}
        {agent.heartbeat?.nextRunAt ? ` · 다음 ${when(agent.heartbeat.nextRunAt)}` : ''}
      </p>
      <div className="row">
        <button type="button" className="ghost" disabled={busy} onClick={onFlip}>
          {paused ? '재개' : '중지'}
        </button>
        <button type="button" className="ghost" onClick={onEdit}>
          편집
        </button>
        <button type="button" className="ghost" onClick={onHeartbeat}>
          하트비트
        </button>
      </div>
    </article>
  );
}
