'use client';

import { type FormEvent, type KeyboardEvent, useId, useState } from 'react';
import type { Agent } from './types';

/** 메시지 · 목표의 길이 (서버 Chat.MESSAGE_MAX · GOAL_MAX) */
const MESSAGE_MAX = 8000;
const GOAL_MAX = 300;

/** 보낼 본문. 상대를 비우면 기본 대표, 프로젝트는 git 주소 그대로 (서버가 host/owner/repo로 맞춘다) */
export type ChatStart = {
  message: string;
  agentId?: string;
  goal?: string;
  project?: string;
};

// 새 대화의 입력 (홈 · 대화 메뉴). 입력 하나에 상대 · 프로젝트 · 목표를 곁들인다.
// Enter로 보내고 Shift+Enter로 줄을 바꾼다 (한글 조합 중의 Enter는 보내지 않는다). 보낸 뒤 칸 비우기는 패널이 key로.
export function ChatStartForm({
  partners,
  projects,
  busy,
  problem,
  onSubmit,
}: {
  /** 관리자 바로 아래 에이전트 (멈추지 않은). 기본 대표가 있으면 비워 두는 것이 기본 */
  partners: readonly Agent[];
  /** 앞서 쓴 프로젝트 (고르기 쉽게) */
  projects: readonly string[];
  busy: boolean;
  problem: string | null;
  onSubmit: (body: ChatStart) => void;
}) {
  const ids = useId();
  const lead = partners.find((a) => a.lead) ?? null;
  const [message, setMessage] = useState('');
  const [agentId, setAgentId] = useState(lead ? '' : (partners[0]?.id ?? ''));
  const [project, setProject] = useState('');
  const [goal, setGoal] = useState('');
  const empty = partners.length === 0;

  function send(e?: FormEvent) {
    e?.preventDefault();
    const text = message.trim();
    if (!text || busy || empty) return;
    onSubmit({
      message: text,
      ...(agentId ? { agentId } : {}),
      ...(goal.trim() ? { goal: goal.trim() } : {}),
      ...(project.trim() ? { project: project.trim() } : {}),
    });
  }

  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  }

  return (
    <form className="start-form" onSubmit={send}>
      <textarea
        className="input"
        aria-label="맡길 일"
        placeholder="무엇을 맡길까요? (Enter로 보내기, Shift+Enter로 줄 바꿈)"
        rows={3}
        maxLength={MESSAGE_MAX}
        value={message}
        disabled={empty}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={keys}
      />
      <div className="start-tools">
        <label className="start-pick">
          <span>상대</span>
          <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {lead && <option value="">기본 대표 · {lead.name}</option>}
            {partners
              .filter((a) => a.id !== lead?.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="start-pick">
          <span>프로젝트</span>
          <input
            className="input"
            list={`${ids}-projects`}
            placeholder="git 주소 (선택)"
            maxLength={400}
            value={project}
            onChange={(e) => setProject(e.target.value)}
          />
          <datalist id={`${ids}-projects`}>
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="start-pick grow">
          <span>목표</span>
          <input
            className="input"
            placeholder="끝났다고 볼 기준 한 줄 (선택)"
            maxLength={GOAL_MAX}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        <button type="submit" className="cta small" disabled={busy || empty || !message.trim()}>
          {busy ? '보내는 중' : '맡기기'}
        </button>
      </div>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}
