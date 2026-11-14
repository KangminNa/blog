'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import { CHECKPOINTS } from '../../_task/labels';
import type { Agent, Goal } from '../../_task/types';

/** 시작할 때 보내는 본문 (POST /api/goal-runs). requestId는 패널이 붙인다 */
export type GoalRunBody = {
  goalId: string;
  agentId: string;
  instruction: string;
  criteria: string[];
  checkpoint: string;
  maxRounds: number;
};

/** 서버의 GoalRun.ROUNDS_LIMIT (주인이 처음 정하는 한도. 결재로 한 회차씩 더 늘린다) */
const ROUNDS_LIMIT = 20;
const CRITERIA_MAX = 20;

// 목표 달성까지 맡기기: 칸과 보낼 본문만 가진다 (시작은 패널).
export function GoalRunForm({
  goals,
  agents,
  busy,
  problem,
  onSubmit,
  onClose,
}: {
  goals: readonly Goal[];
  agents: readonly Agent[];
  busy: boolean;
  problem: string | null;
  onSubmit: (body: GoalRunBody, requestId: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [goal, setGoal] = useState(goals[0]?.id ?? '');
  const [agent, setAgent] = useState(agents[0]?.id ?? '');
  const [instruction, setInstruction] = useState('');
  const [criteria, setCriteria] = useState('');
  const [checkpoint, setCheckpoint] = useState('milestone');
  const [maxRounds, setMaxRounds] = useState(5);
  // 같은 내용을 다시 보내면 같은 requestId: 응답을 놓쳐 다시 눌러도 실행은 하나다
  const requestId = useRef<string | null>(null);

  function change(apply: () => void) {
    requestId.current = null;
    apply();
  }

  const lines = criteria
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  function submit(event: FormEvent) {
    event.preventDefault();
    requestId.current ??= crypto.randomUUID();
    onSubmit(
      {
        goalId: goal,
        agentId: agent,
        instruction: instruction.trim(),
        criteria: lines,
        checkpoint,
        maxRounds,
      },
      requestId.current,
    );
  }

  return (
    <form className="panel" onSubmit={submit} aria-label="목표 달성까지 맡기기">
      <b>목표 달성까지 맡기기</b>
      <p className="note">
        팀장 에이전트가 회차를 이어 돌며 하위 에이전트에게 나눠 맡겨요. 결재는 정한 때와 끝에만 와요
      </p>
      <div className="field">
        <label htmlFor={`${id}-goal`}>목표</label>
        <select
          id={`${id}-goal`}
          className="input"
          value={goal}
          required
          onChange={(e) => change(() => setGoal(e.target.value))}
        >
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-agent`}>팀장</label>
        <select
          id={`${id}-agent`}
          className="input"
          value={agent}
          required
          onChange={(e) => change(() => setAgent(e.target.value))}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <small>나눠 맡길 에이전트는 조직도에서 이 팀장에게 보고하는 에이전트예요</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-instruction`}>지시</label>
        <textarea
          id={`${id}-instruction`}
          className="input"
          rows={4}
          value={instruction}
          maxLength={4000}
          required
          onChange={(e) => change(() => setInstruction(e.target.value))}
        />
        <small>
          읽을 주소를 여기에 적어 두면 회차마다 열 수 있어요 (비공개를 보는 에이전트는 적힌
          사이트만)
        </small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-criteria`}>완료 조건</label>
        <textarea
          id={`${id}-criteria`}
          className="input"
          rows={3}
          value={criteria}
          aria-invalid={lines.length > CRITERIA_MAX}
          onChange={(e) => change(() => setCriteria(e.target.value))}
        />
        <small>
          한 줄에 하나, {CRITERIA_MAX}개까지. 팀장은 모두 채웠을 때만 다 됐다고 보고해요
        </small>
      </div>
      <div className="field">
        <fieldset className="checks">
          <legend>중간 결재</legend>
          {Object.entries(CHECKPOINTS).map(([value, label]) => (
            <label key={value} className="check">
              <input
                type="radio"
                name={`${id}-checkpoint`}
                value={value}
                checked={checkpoint === value}
                onChange={() => change(() => setCheckpoint(value))}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <small>
          진전이 없거나, 실패하거나, 회차 한도에 닿으면 언제든 결재가 와요. 완료는 늘 최종 결재로
        </small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-rounds`}>회차 한도</label>
        <input
          id={`${id}-rounds`}
          className="input"
          type="number"
          min={1}
          max={ROUNDS_LIMIT}
          value={maxRounds}
          onChange={(e) => change(() => setMaxRounds(Number(e.target.value)))}
        />
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button
          type="submit"
          className="cta small"
          disabled={busy || !goal || !agent || !instruction.trim() || lines.length > CRITERIA_MAX}
        >
          시작
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
