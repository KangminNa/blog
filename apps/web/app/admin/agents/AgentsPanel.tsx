'use client';

import { useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { SCOPE_LABELS } from '../../_lib/types';
import { actionLabel, TASK_STATUS, TOOL_LABELS } from '../../_task/labels';
import { useAgents, useTasksIn } from '../../_task/live';
import { AgentUsage } from '../../_task/parts';
import type { Agent } from '../../_task/types';
import { useNotify } from '../AdminShell';
import { AgentForm } from './AgentForm';

const NEW = 'new';

// 에이전트: 사용량과 한도, 추가, 편집, 중지, 재개.
export function AgentsPanel({ adding }: { adding: boolean }) {
  const notify = useNotify();
  const agents = useAgents();
  const running = useTasksIn('running');
  const waiting = useTasksIn('waiting');
  // 열린 입력 칸: 추가, 또는 편집 중인 에이전트의 id
  const [open, setOpen] = useState<string | null>(adding ? NEW : null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = agents.data?.agents;

  /** 실행 중이거나 결재를 기다리는 작업이 있으면 그 상태 */
  function workOf(agent: Agent): string | null {
    if (running.data?.tasks.some((t) => t.agentId === agent.id)) return 'running';
    if (waiting.data?.tasks.some((t) => t.agentId === agent.id)) return 'waiting';
    return null;
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
    await agents.reload();
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
      {open === NEW && (
        <AgentForm
          agent={null}
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
            open === a.id ? (
              <AgentForm
                key={a.id}
                agent={a}
                onSaved={saved}
                onClose={() => setOpen(null)}
                reload={agents.reload}
              />
            ) : (
              <AgentCard
                key={a.id}
                agent={a}
                work={workOf(a)}
                busy={busy === a.id}
                onFlip={() => flip(a)}
                onEdit={() => setOpen(a.id)}
              />
            ),
          )}
        </div>
      )}
    </>
  );
}

function AgentCard({
  agent,
  work,
  busy,
  onFlip,
  onEdit,
}: {
  agent: Agent;
  work: string | null;
  busy: boolean;
  onFlip: () => void;
  onEdit: () => void;
}) {
  const paused = agent.status === 'paused';
  return (
    <article className="agent" aria-label={agent.name}>
      <div className="agent-top">
        <div className="item-main">
          <b>{agent.name}</b>
          <small>
            {agent.role ? `${agent.role} · ` : ''}
            {TOOL_LABELS[agent.tool] ?? agent.tool}
          </small>
        </div>
        <span className={paused ? 'pill off' : work ? 'pill on' : 'pill'}>
          {paused ? '중지' : work ? TASK_STATUS[work] : '대기'}
        </span>
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
      <div className="row">
        <button type="button" className="ghost" disabled={busy} onClick={onFlip}>
          {paused ? '재개' : '중지'}
        </button>
        <button type="button" className="ghost" onClick={onEdit}>
          편집
        </button>
      </div>
    </article>
  );
}
