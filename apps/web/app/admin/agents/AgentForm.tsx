'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import { SCOPE_LABELS } from '../../_lib/types';
import {
  actionLabel,
  LOGIN_SITE,
  MERGE_PULL,
  PUBLISH_POST,
  PUBLISH_SITE,
  TOOL_LABELS,
} from '../../_task/labels';
import type { RunnerChoice } from '../../_task/live';
import type { Agent } from '../../_task/types';
import { RunnerField } from './RunnerField';

/** 에이전트에게 줄 수 있는 권한. run은 러너의 것이라 없다 (서버의 Agent.SCOPES와 맞춘다) */
const SCOPES = ['upload', 'read_public', 'read_all', 'tidy', 'write', 'browse', 'code', 'make'];
/** 고를 수 있는 결재 동작: 승인 뒤 실행하는 모듈이 있는 것만. 없으면 작업이 끝나지 않는다. 한도 변경은 서버만 올린다 */
const ACTIONS = [PUBLISH_POST, PUBLISH_SITE, LOGIN_SITE, MERGE_PULL];
/** 브라우저 사용을 켜면 함께 켜는 결재 동작: 러너가 이 에이전트의 이름으로 클릭 · 로그인 결재를 올린다 */
const BROWSE_ACTIONS = [PUBLISH_SITE, LOGIN_SITE];

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

/** 저장할 때 보내는 본문 (POST · PATCH /api/agents). 만들기의 requestId와 고치기의 version은 패널이 붙인다 */
export type AgentBody = {
  name: string;
  role: string;
  tool: string;
  scopes: readonly string[];
  approvalActions: readonly string[];
  monthlyLimit: number | null;
  fiveHourLimit: number | null;
  planStopPercent: number | null;
  reportsTo: string | null;
  runnerId: string | null;
};

// 에이전트 추가·편집 폼: 칸의 상태와 보낼 본문만 가진다. 저장은 패널이 돌린다 (onSubmit). agent가 있으면 편집이다.
export function AgentForm({
  agent,
  agents,
  ownerName,
  runners,
  busy,
  problem,
  onSubmit,
  onClear,
  onClose,
}: {
  agent: Agent | null;
  /** 공간의 모든 에이전트 (보고 대상 고르기) */
  agents: readonly Agent[];
  /** 관리자의 이름 (보고 대상이 없으면 이 사람에게) */
  ownerName: string;
  /** 묶을 수 있는 러너 (실행 러너 고르기) */
  runners: readonly RunnerChoice[];
  busy: boolean;
  problem: string | null;
  onSubmit: (body: AgentBody, requestId: string) => void;
  /** 다시 저장한다: 앞의 오류 문구를 지운다 */
  onClear: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(agent?.name ?? '');
  const [role, setRole] = useState(agent?.role ?? '');
  const [tool, setTool] = useState(agent?.tool ?? 'claude');
  const [reportsTo, setReportsTo] = useState(agent?.reportsTo ?? '');
  const [runnerId, setRunnerId] = useState(agent?.runnerId ?? '');
  const [scopes, setScopes] = useState<readonly string[]>(agent?.scopes ?? []);
  const sandboxed = scopes.includes('code') || scopes.includes('make');
  const [actions, setActions] = useState<readonly string[]>(agent?.approvalActions ?? []);
  const [limit, setLimit] = useState(agent?.monthlyLimit?.toString() ?? '');
  const [fiveHour, setFiveHour] = useState(agent?.fiveHourLimit?.toString() ?? '');
  const [planStop, setPlanStop] = useState(agent?.planStopPercent?.toString() ?? '');
  const [problems, setProblems] = useState<{
    limit?: string;
    fiveHour?: string;
    planStop?: string;
  }>({});
  // 같은 내용을 다시 보내면 같은 requestId: 응답을 놓쳐 다시 눌러도 에이전트는 하나다
  const requestId = useRef<string | null>(null);

  function change(apply: () => void) {
    requestId.current = null;
    apply();
  }

  function submit(event: FormEvent) {
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
    onClear();
    if (monthlyLimit === undefined || fiveHourLimit === undefined || planStopPercent === undefined)
      return;
    requestId.current ??= crypto.randomUUID();
    onSubmit(
      {
        name: name.trim(),
        role: role.trim(),
        tool,
        scopes,
        approvalActions: actions,
        monthlyLimit,
        fiveHourLimit,
        planStopPercent,
        reportsTo: reportsTo || null,
        // 코드 · 만들기는 코드 러너 칸에서만 돌아 묶지 않는다 (서버도 막는다)
        runnerId: sandboxed ? null : runnerId || null,
      },
      requestId.current,
    );
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
          <option value="">{ownerName}</option>
          {bossesFor(agent, agents).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <small id={`${id}-boss-help`}>
          보고 대상은 이 에이전트에게 일을 나눠 맡길 수 있어요. 조직도는 4단계까지, 결재는 늘{' '}
          {ownerName}
        </small>
      </div>
      <RunnerField
        id={`${id}-runner`}
        value={runnerId}
        sandboxed={sandboxed}
        runners={runners}
        onChange={(value) => change(() => setRunnerId(value))}
      />
      <fieldset className="checks">
        <legend>권한</legend>
        <small>
          세션 정리는 정리와 전체 읽기 권한이 함께 필요. 브라우저 사용 · 코드 작업 · 파일 만들기는
          전체 읽기 · 초안 작성과 함께 줄 수 없음
        </small>
        {SCOPES.map((s) => (
          <label key={s} className="check">
            <input
              type="checkbox"
              checked={scopes.includes(s)}
              onChange={() =>
                change(() => {
                  const next = toggled(scopes, s);
                  setScopes(next);
                  if (s === 'browse' && next.includes(s))
                    setActions([...new Set([...actions, ...BROWSE_ACTIONS])]);
                })
              }
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
