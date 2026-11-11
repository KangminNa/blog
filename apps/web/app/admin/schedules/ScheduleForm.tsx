'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { flatTree, WEEKDAY_LABELS } from '../../_task/labels';
import { useGoals } from '../../_task/live';
import type { Agent, Schedule } from '../../_task/types';

/** N시간마다에서 고를 수 있는 값: 하루를 나누어떨어지게 하는 수 */
const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
const DAYS = [1, 2, 3, 4, 5, 6, 7];
/** 하루 한도의 끝 (서버의 Schedule.DAILY_MAX_LIMIT) */
const DAILY_MAX_LIMIT = 24;

/** 이 브라우저의 시간대 (처음 정할 때의 기본값) */
function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// 스케줄 하나를 만들거나 고친다. 정한 시각에 지시대로 작업이 생긴다.
// 담당을 정하고 지시를 비우면 정기 확인(맡은 목표와 진행 중인 일을 확인)이 된다 (예전의 하트비트).
// 앞 작업이 끝나지 않았거나 담당이 쉬는 중이면 그 차례는 건너뛰고, 하루 한도에 닿으면 그날은 더 만들지 않는다.
export function ScheduleForm({
  schedule,
  agents,
  agentId: presetAgent,
  onSaved,
  onClose,
  reload,
}: {
  /** 고칠 스케줄. 없으면 새로 만든다 */
  schedule: Schedule | null;
  agents: readonly Agent[];
  /** 새로 만들 때 미리 고를 담당 (에이전트 화면에서 왔을 때) */
  agentId: string | null;
  onSaved: (message: string) => void;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const id = useId();
  const goals = useGoals();
  const [title, setTitle] = useState(schedule?.title ?? '정기 확인');
  const [agentId, setAgentId] = useState(schedule?.agentId ?? presetAgent ?? '');
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [mode, setMode] = useState(schedule?.mode ?? 'daily');
  const [atTime, setAtTime] = useState(schedule?.atTime ?? '09:00');
  const [weekdays, setWeekdays] = useState<readonly number[]>(schedule?.weekdays ?? DAYS);
  const [everyHours, setEveryHours] = useState(schedule?.everyHours ?? 4);
  const [timeZone, setTimeZone] = useState(schedule?.timeZone ?? browserZone());
  const [goalId, setGoalId] = useState(schedule?.goalId ?? '');
  const [instruction, setInstruction] = useState(schedule?.instruction ?? '');
  const [dailyMax, setDailyMax] = useState(schedule?.dailyMax ?? 3);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // 만들기: 같은 내용을 다시 보내면 같은 requestId (응답을 놓쳐 다시 눌러도 스케줄은 하나)
  const requestId = useRef<string | null>(null);
  const goalRows = flatTree(goals.data?.goals ?? [], (g) => g.parentId).filter(
    ({ item }) => item.status === 'active' || item.id === goalId,
  );

  function edit(apply: () => void) {
    requestId.current = null;
    setProblem(null);
    apply();
  }

  function toggleDay(day: number) {
    edit(() =>
      setWeekdays(
        weekdays.includes(day) ? weekdays.filter((d) => d !== day) : [...weekdays, day].sort(),
      ),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const body = {
      title: title.trim(),
      agentId: agentId || null,
      enabled,
      mode,
      ...(mode === 'daily' ? { atTime, weekdays } : { everyHours }),
      timeZone: timeZone.trim(),
      instruction: instruction.trim(),
      goalId: goalId || null,
      dailyMax,
    };
    requestId.current ??= crypto.randomUUID();
    const reply = schedule
      ? await api('PATCH', `/api/schedules/${schedule.id}`, { ...body, version: schedule.version })
      : await api('POST', '/api/schedules', { ...body, requestId: requestId.current });
    setBusy(false);
    if (reply.ok) {
      requestId.current = null;
      return onSaved(`${body.title} ${enabled ? '켜짐' : '꺼짐'}`);
    }
    if (reply.status === 409) {
      await reload();
      return setProblem('이미 바뀐 스케줄이에요. 최신 내용을 다시 읽었어요');
    }
    setProblem(describe(reply.error));
  }

  const noOrder = agentId === '' && instruction.trim() === '';

  return (
    <form
      className="panel stack"
      onSubmit={submit}
      aria-label={schedule ? `${schedule.title} 고치기` : '새 스케줄'}
    >
      <b>{schedule ? `${schedule.title} 고치기` : '새 스케줄'}</b>
      <div className="field">
        <label htmlFor={`${id}-title`}>이름</label>
        <input
          id={`${id}-title`}
          className="input"
          value={title}
          required
          maxLength={120}
          onChange={(e) => edit(() => setTitle(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-agent`}>담당</label>
        <select
          id={`${id}-agent`}
          className="input"
          value={agentId}
          onChange={(e) => edit(() => setAgentId(e.target.value))}
        >
          <option value="">자동 배정</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.status === 'paused' ? `${a.name} (중지)` : a.name}
            </option>
          ))}
        </select>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={() => edit(() => setEnabled(!enabled))}
        />
        정해진 시각에 돌리기
      </label>
      <div className="field">
        <label htmlFor={`${id}-mode`}>주기</label>
        <select
          id={`${id}-mode`}
          className="input"
          value={mode}
          onChange={(e) => edit(() => setMode(e.target.value))}
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
              onChange={(e) => edit(() => setAtTime(e.target.value))}
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
            onChange={(e) => edit(() => setEveryHours(Number(e.target.value)))}
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
        <label htmlFor={`${id}-max`}>하루 한도</label>
        <input
          id={`${id}-max`}
          className="input"
          type="number"
          min={1}
          max={DAILY_MAX_LIMIT}
          value={dailyMax}
          required
          onChange={(e) => edit(() => setDailyMax(Number(e.target.value)))}
        />
        <small>시간대 기준 하루에 만드는 작업 수. "지금 한 번"도 함께 세요</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-zone`}>시간대</label>
        <input
          id={`${id}-zone`}
          className="input"
          value={timeZone}
          required
          maxLength={100}
          onChange={(e) => edit(() => setTimeZone(e.target.value))}
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
            onChange={(e) => edit(() => setGoalId(e.target.value))}
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
          placeholder={
            agentId
              ? '비우면 정기 확인: 맡은 목표와 진행 중인 일을 확인하고, 할 일이 있으면 하거나 팀에게 맡겨요'
              : '자동 배정이면 지시가 있어야 해요'
          }
          onChange={(e) => edit(() => setInstruction(e.target.value))}
        />
        <small>앞 작업이 끝나지 않았거나 담당이 쉬는 중이면 그 차례는 건너뛰어요</small>
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button
          type="submit"
          className="cta small"
          disabled={busy || noOrder || !title.trim() || (mode === 'daily' && weekdays.length === 0)}
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
