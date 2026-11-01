'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { SCOPE_LABELS } from '../../_lib/types';
import { actionLabel, PUBLISH_POST, TOOL_LABELS } from '../../_task/labels';
import type { Agent } from '../../_task/types';

/** 에이전트에게 줄 수 있는 권한. run은 러너의 것이라 없다 (서버의 Agent.SCOPES와 맞춘다) */
const SCOPES = ['upload', 'read_public', 'read_all', 'tidy', 'write'];
/** 고를 수 있는 결재 동작. 한도 변경은 서버만 올린다 */
const ACTIONS = [PUBLISH_POST, 'sns.post.send'];

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

// 에이전트 추가·편집. agent가 있으면 편집이다.
export function AgentForm({
  agent,
  onSaved,
  onClose,
  reload,
}: {
  agent: Agent | null;
  onSaved: (message: string) => void;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(agent?.name ?? '');
  const [role, setRole] = useState(agent?.role ?? '');
  const [tool, setTool] = useState(agent?.tool ?? 'claude');
  const [scopes, setScopes] = useState<readonly string[]>(agent?.scopes ?? []);
  const [actions, setActions] = useState<readonly string[]>(agent?.approvalActions ?? []);
  const [limit, setLimit] = useState(agent?.monthlyLimit?.toString() ?? '');
  const [problems, setProblems] = useState<{ limit?: string }>({});
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
    const found = monthlyLimit === undefined ? { limit: '1 이상의 정수를 입력해 주세요' } : {};
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
      <fieldset className="checks">
        <legend>권한</legend>
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
