'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { flatTree } from './labels';
import { useGoals } from './live';
import type { Agent, Task } from './types';

// 작업 입력 (홈, 작업). 담당을 고르지 않으면 활성 에이전트가 맡는다. 목표를 고르면 에이전트가 목표의 사슬을 함께 받는다.
export function AskForm({
  agents,
  onCreated,
  focus = false,
}: {
  /** 아직 읽지 못했으면 null */
  agents: readonly Agent[] | null;
  onCreated: (task: Task) => void;
  /** 후속 작업으로 들어오면 바로 입력한다 */
  focus?: boolean;
}) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [instruction, setInstruction] = useState('');
  const [agentId, setAgentId] = useState('');
  const [asPage, setAsPage] = useState(false);
  const [goalId, setGoalId] = useState('');
  const goals = useGoals();
  // 진행 중인 목표에만 작업을 더할 수 있다. 나무 순서대로, 깊이만큼 들여 쓴다
  const goalRows = flatTree(goals.data?.goals ?? [], (g) => g.parentId).filter(
    ({ item }) => item.status === 'active',
  );
  const action = useAction();
  // 같은 내용을 다시 보내면 같은 requestId: 응답을 놓쳐 다시 눌러도 작업은 하나다
  const requestId = useRef<string | null>(null);

  function edit(apply: () => void) {
    requestId.current = null;
    action.clear();
    apply();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const reply = await action.run('ask', () => {
      requestId.current ??= crypto.randomUUID();
      return api<Task>('POST', '/api/tasks', {
        requestId: requestId.current,
        instruction: instruction.trim(),
        ...(agentId ? { agentId } : {}),
        ...(goalId ? { goalId } : {}),
        // 페이지로 받기: 만들기 일로 맡기고, 끝나면 결과물 묶음이 곧바로 페이지가 된다
        ...(asPage ? { kind: 'make', page: {} } : {}),
      });
    });
    if (!reply?.ok) return;
    requestId.current = null;
    setInstruction('');
    setAgentId('');
    setGoalId('');
    setAsPage(false);
    onCreated(reply.data);
  }

  useEffect(() => {
    if (focus) box.current?.focus();
  }, [focus]);

  const none = agents !== null && agents.length === 0;

  return (
    <form className="ask" onSubmit={submit}>
      <label htmlFor={`${id}-text`}>작업 내용</label>
      <textarea
        ref={box}
        id={`${id}-text`}
        rows={2}
        value={instruction}
        placeholder="작업 내용을 입력하세요"
        onChange={(e) => edit(() => setInstruction(e.target.value))}
      />
      <div className="ask-row">
        <label htmlFor={`${id}-who`}>담당</label>
        <select
          id={`${id}-who`}
          className="input"
          value={agentId}
          onChange={(e) => edit(() => setAgentId(e.target.value))}
        >
          <option value="">자동 배정</option>
          {agents?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.status === 'paused' ? `${a.name} (중지)` : a.name}
            </option>
          ))}
        </select>
        {goalRows.length > 0 && (
          <>
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
          </>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={asPage}
            onChange={(e) => edit(() => setAsPage(e.target.checked))}
          />
          페이지로 받기
        </label>
        <span className="note">발행·전송·삭제는 결재 후 실행</span>
        <span className="spacer" />
        <button
          type="submit"
          className="cta small"
          disabled={action.busy !== null || !instruction.trim()}
        >
          실행
        </button>
      </div>
      {none && (
        <p className="note">
          에이전트 없음. 작업은 에이전트가 생길 때까지 대기{' · '}
          <Link href="/admin/agents?new=1">에이전트 추가</Link>
        </p>
      )}
      {action.problem && <p className="error">{action.problem}</p>}
    </form>
  );
}
