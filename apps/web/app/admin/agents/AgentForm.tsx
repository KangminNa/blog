'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { SCOPE_LABELS } from '../../_lib/types';
import { actionLabel, PUBLISH_POST, TOOL_LABELS } from '../../_task/labels';
import type { Agent } from '../../_task/types';

/** 에이전트에게 줄 수 있는 권한. run은 러너의 것이라 없다 (서버의 Agent.SCOPES와 맞춘다) */
const SCOPES = ['upload', 'read_public', 'read_all', 'tidy', 'write'];
/** 고를 수 있는 결재 동작: 승인 뒤 실행하는 모듈이 있는 것만. 없으면 작업이 끝나지 않는다. 한도 변경은 서버만 올린다 */
const ACTIONS = [PUBLISH_POST];

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** 빈 칸은 한도 없음. 맞지 않는 값이면 undefined */
function limitOf(text: string): number | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 1 ? limit : undefined;
}

/** 빈 칸은 쓰지 않음. 맞지 않는 값이면 undefined */
function percentOf(text: string): number | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  const percent = Number(value);
  return Number.isInteger(percent) && percent >= 1 && percent <= 100 ? percent : undefined;
}

/** 보고 대상으로 고를 수 있는 에이전트: 자기 자신과 자기 아래 팀원은 뺀다 (서버의 Agent.reportTo가 원본) */
function bossesFor(agent: Agent | null, agents: readonly Agent[]): readonly Agent[] {
  if (!agent) return agents;
  const below = new Set([agent.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of agents)
      if (a.reportsTo && below.has(a.reportsTo) && !below.has(a.id)) {
        below.add(a.id);
        grew = true;
      }
  }
  return agents.filter((a) => !below.has(a.id));
}

// 에이전트 추가·편집. agent가 있으면 편집이다.
export function AgentForm({
  agent,
  agents,
  onSaved,
  onClose,
  reload,
}: {
  agent: Agent | null;
  /** 공간의 모든 에이전트 (보고 대상 고르기) */
  agents: readonly Agent[];
  onSaved: (message: string) => void;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(agent?.name ?? '');
  const [role, setRole] = useState(agent?.role ?? '');
  const [tool, setTool] = useState(agent?.tool ?? 'claude');
  const [reportsTo, setReportsTo] = useState(agent?.reportsTo ?? '');
  const [scopes, setScopes] = useState<readonly string[]>(agent?.scopes ?? []);
  const [actions, setActions] = useState<readonly string[]>(agent?.approvalActions ?? []);
  const [limit, setLimit] = useState(agent?.monthlyLimit?.toString() ?? '');
  const [fiveHour, setFiveHour] = useState(agent?.fiveHourLimit?.toString() ?? '');
  const [planStop, setPlanStop] = useState(agent?.planStopPercent?.toString() ?? '');
  const [problems, setProblems] = useState<{
    limit?: string;
    fiveHour?: string;
    planStop?: string;
  }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  // 같은 내용을 다시 보내면 같은 requestId: 응답을 놓쳐 다시 눌러도 에이전트는 하나다
  const requestId = useRef<string | null>(null);

  function change(apply: () => void) {
    requestId.current = null;
    apply();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const monthlyLimit = limitOf(limit);
    const fiveHourLimit = limitOf(fiveHour);
    const planStopPercent = percentOf(planStop);
    const found = {
      ...(monthlyLimit === undefined ? { limit: '1 이상의 정수를 입력해 주세요' } : {}),
      ...(fiveHourLimit === undefined ? { fiveHour: '1 이상의 정수를 입력해 주세요' } : {}),
      ...(planStopPercent === undefined ? { planStop: '1~100 사이의 정수를 입력해 주세요' } : {}),
    };
    setProblems(found);
    setProblem(null);
    if (Object.keys(found).length > 0 || sending.current) return;
    sending.current = true;
    setBusy(true);
    const fields = {
      name: name.trim(),
      role: role.trim(),
      tool,
      scopes,
      approvalActions: actions,
      monthlyLimit,
      fiveHourLimit,
      planStopPercent,
      reportsTo: reportsTo || null,
    };
    requestId.current ??= crypto.randomUUID();
    const reply = agent
      ? await api('PATCH', `/api/agents/${agent.id}`, { ...fields, version: agent.version })
      : await api('POST', '/api/agents', { ...fields, requestId: requestId.current });
    sending.current = false;
    setBusy(false);
    if (reply.ok) return onSaved(agent ? '에이전트 저장됨' : '에이전트 추가됨');
    if (reply.status === 409) {
      await reload();
      return setProblem('이미 바뀐 에이전트예요. 다시 저장하면 입력한 내용으로 덮어요');
    }
    setProblem(describe(reply.error));
  }

  return (
    <form
      className="panel"
      onSubmit={submit}
      aria-label={agent ? `${agent.name} 편집` : '에이전트 추가'}
    >
      <div className="field">
        <label htmlFor={`${id}-name`}>이름</label>
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          maxLength={60}
          required
          onChange={(e) => change(() => setName(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-role`}>역할</label>
        <textarea
          id={`${id}-role`}
          className="input"
          rows={2}
          value={role}
          maxLength={2000}
          onChange={(e) => change(() => setRole(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-tool`}>AI 도구</label>
        <select
          id={`${id}-tool`}
          className="input"
          value={tool}
          onChange={(e) => change(() => setTool(e.target.value))}
        >
          {Object.entries(TOOL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-boss`}>보고 대상</label>
        <select
          id={`${id}-boss`}
          className="input"
          value={reportsTo}
          aria-describedby={`${id}-boss-help`}
          onChange={(e) => change(() => setReportsTo(e.target.value))}
        >
          <option value="">주인</option>
          {bossesFor(agent, agents).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <small id={`${id}-boss-help`}>
          보고 대상은 이 에이전트에게 일을 나눠 맡길 수 있어요. 조직도는 4단계까지, 결재는 늘 주인
        </small>
      </div>
      <fieldset className="checks">
        <legend>권한</legend>
        <small>세션 정리는 정리와 전체 읽기 권한이 함께 필요</small>
        {SCOPES.map((s) => (
          <label key={s} className="check">
            <input
              type="checkbox"
              checked={scopes.includes(s)}
              onChange={() => change(() => setScopes(toggled(scopes, s)))}
            />
            {SCOPE_LABELS[s]}
          </label>
        ))}
      </fieldset>
      <fieldset className="checks">
        <legend>결재 요청할 수 있는 동작</legend>
        {[...new Set([...ACTIONS, ...(agent?.approvalActions ?? [])])].map((a) => (
          <label key={a} className="check">
            <input
              type="checkbox"
              checked={actions.includes(a)}
              onChange={() => change(() => setActions(toggled(actions, a)))}
            />
            {actionLabel(a)}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-limit`}>월 한도 (토큰)</label>
        <input
          id={`${id}-limit`}
          className="input"
          inputMode="numeric"
          value={limit}
          aria-invalid={problems.limit !== undefined}
          aria-describedby={`${id}-limit-help`}
          onChange={(e) => change(() => setLimit(e.target.value))}
        />
        <small id={`${id}-limit-help`}>비우면 한도 없음. 넘기면 자동 중지 후 결재 요청</small>
        {problems.limit && <p className="error">{problems.limit}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${id}-five-hour`}>5시간 한도 (토큰)</label>
        <input
          id={`${id}-five-hour`}
          className="input"
          inputMode="numeric"
          value={fiveHour}
          aria-invalid={problems.fiveHour !== undefined}
          aria-describedby={`${id}-five-hour-help`}
          onChange={(e) => change(() => setFiveHour(e.target.value))}
        />
        <small id={`${id}-five-hour-help`}>
          비우면 한도 없음. 닿으면 새 작업만 쉬고 시간이 지나면 다시 시작
        </small>
        {problems.fiveHour && <p className="error">{problems.fiveHour}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${id}-plan-stop`}>구독 사용률 N%에서 멈춤</label>
        <input
          id={`${id}-plan-stop`}
          className="input"
          inputMode="numeric"
          value={planStop}
          aria-invalid={problems.planStop !== undefined}
          aria-describedby={`${id}-plan-stop-help`}
          onChange={(e) => change(() => setPlanStop(e.target.value))}
        />
        <small id={`${id}-plan-stop-help`}>
          1~100. 비우면 멈추지 않음. 닿으면 새 작업만 쉬고 초기화되면 다시 시작
        </small>
        {problems.planStop && <p className="error">{problems.planStop}</p>}
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy || !name.trim()}>
          {agent ? '저장' : '추가'}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
