'use client';

import { type FormEvent, useId, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { flatTree, WEEKDAY_LABELS } from '../../_task/labels';
import { useGoals } from '../../_task/live';
import type { Agent, AgentHeartbeat } from '../../_task/types';

/** N시간마다에서 고를 수 있는 값: 하루를 나누어떨어지게 하는 수 */
const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** 이 브라우저의 시간대 (처음 정할 때의 기본값) */
function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// 하트비트: 정해진 시각에 에이전트를 깨워 자기 일을 확인하게 한다. 앞 작업이 끝나지 않았거나 쉬는 중이면 그 차례는 건너뛴다.
export function HeartbeatForm({
  agent,
  onSaved,
  onClose,
  reload,
}: {
  agent: Agent;
  onSaved: (message: string) => void;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const id = useId();
  const before: AgentHeartbeat | null = agent.heartbeat;
  const goals = useGoals();
  const [enabled, setEnabled] = useState(before?.enabled ?? true);
  const [mode, setMode] = useState(before?.mode ?? 'daily');
  const [atTime, setAtTime] = useState(before?.atTime ?? '09:00');
  const [weekdays, setWeekdays] = useState<readonly number[]>(before?.weekdays ?? DAYS);
  const [everyHours, setEveryHours] = useState(before?.everyHours ?? 4);
  const [timeZone, setTimeZone] = useState(before?.timeZone ?? browserZone());
  const [goalId, setGoalId] = useState(before?.goalId ?? '');
  const [instruction, setInstruction] = useState(before?.instruction ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const goalRows = flatTree(goals.data?.goals ?? [], (g) => g.parentId).filter(
    ({ item }) => item.status === 'active' || item.id === goalId,
  );

  function toggleDay(day: number) {
    setWeekdays(
      weekdays.includes(day) ? weekdays.filter((d) => d !== day) : [...weekdays, day].sort(),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const reply = await api('PUT', `/api/agents/${agent.id}/heartbeat`, {
      version: before?.version ?? 0,
      enabled,
      mode,
      ...(mode === 'daily' ? { atTime, weekdays } : { everyHours }),
      timeZone: timeZone.trim(),
      instruction: instruction.trim(),
      goalId: goalId || null,
    });
    setBusy(false);
    if (reply.ok)
      return onSaved(enabled ? `${agent.name} 하트비트 켜짐` : `${agent.name} 하트비트 꺼짐`);
    if (reply.status === 409) {
      await reload();
      return setProblem('이미 바뀐 하트비트예요. 최신 내용을 다시 읽었어요');
    }
    setProblem(describe(reply.error));
  }

  return (
    <form className="panel" onSubmit={submit} aria-label={`${agent.name} 하트비트`}>
      <b>{agent.name} 하트비트</b>
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={() => setEnabled(!enabled)} />
        정해진 시각에 깨우기
      </label>
      <div className="field">
        <label htmlFor={`${id}-mode`}>주기</label>
        <select
          id={`${id}-mode`}
          className="input"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="daily">매일 정한 시각</option>
          <option value="hourly">N시간마다</option>
        </select>
      </div>
      {mode === 'daily' ? (
        <>
          <div className="field">
            <label htmlFor={`${id}-at`}>시각</label>
            <input
              id={`${id}-at`}
              className="input"
              type="time"
              value={atTime}
              required
              onChange={(e) => setAtTime(e.target.value)}
            />
          </div>
          <fieldset className="checks">
            <legend>요일</legend>
            {DAYS.map((day) => (
              <label key={day} className="check">
                <input
                  type="checkbox"
                  checked={weekdays.includes(day)}
                  onChange={() => toggleDay(day)}
                />
                {WEEKDAY_LABELS[day]}
              </label>
            ))}
          </fieldset>
        </>
      ) : (
        <div className="field">
          <label htmlFor={`${id}-every`}>간격</label>
          <select
            id={`${id}-every`}
            className="input"
            value={everyHours}
            onChange={(e) => setEveryHours(Number(e.target.value))}
          >
            {EVERY_HOURS.map((n) => (
              <option key={n} value={n}>
                {n}시간마다
              </option>
            ))}
          </select>
          <small>
            시간대 기준 정각 중 시가 N으로 나누어떨어질 때 (4시간마다 → 0·4·8·12·16·20시)
          </small>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-zone`}>시간대</label>
        <input
          id={`${id}-zone`}
          className="input"
          value={timeZone}
          required
          maxLength={100}
          onChange={(e) => setTimeZone(e.target.value)}
        />
        <small>IANA 이름 (예: Asia/Seoul)</small>
      </div>
      {goalRows.length > 0 && (
        <div className="field">
          <label htmlFor={`${id}-goal`}>목표</label>
          <select
            id={`${id}-goal`}
            className="input"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
          >
            <option value="">없음</option>
            {goalRows.map(({ item, depth }) => (
              <option key={item.id} value={item.id}>
                {`${'  '.repeat(depth)}${item.title}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-text`}>지시</label>
        <textarea
          id={`${id}-text`}
          className="input"
          rows={3}
          value={instruction}
          maxLength={4000}
          placeholder="비우면: 맡은 목표와 진행 중인 일을 확인하고, 할 일이 있으면 하거나 팀에게 맡깁니다"
          onChange={(e) => setInstruction(e.target.value)}
        />
        <small>
          앞 하트비트 작업이 끝나지 않았거나 에이전트가 쉬는 중이면 그 차례는 건너뛰어요
        </small>
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button
          type="submit"
          className="cta small"
          disabled={busy || (mode === 'daily' && weekdays.length === 0)}
        >
          저장
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
