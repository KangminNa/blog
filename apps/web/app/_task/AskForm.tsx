'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { api, uploadFile } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { flatTree } from './labels';
import { useGoals } from './live';
import type { Agent, OutputSaved, Task } from './types';

/** 한 번에 붙일 수 있는 파일 (만들기 일의 재료 한도) */
const FILES_MAX = 10;
const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

// 작업 입력 (홈, 작업). 담당을 고르지 않으면 활성 에이전트가 맡는다. 목표를 고르면 에이전트가 목표의 사슬을 함께 받는다.
// 파일을 붙이면 먼저 올려 결과물로 두고, 만들기 일의 재료로 넘긴다 (엑셀 · PDF를 주고 분석 받기).
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
  const [files, setFiles] = useState<File[]>([]);
  // 이미 올린 파일 (작업 만들기에서 실패해 다시 눌러도 다시 올리지 않게)
  const uploaded = useRef(new Map<File, string>());
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
    const reply = await action.run('ask', async () => {
      requestId.current ??= crypto.randomUUID();
      const outputIds: string[] = [];
      for (const file of files) {
        const known = uploaded.current.get(file);
        if (known) {
          outputIds.push(known);
          continue;
        }
        const up = await uploadFile<OutputSaved>(
          `/api/outputs/files?name=${encodeURIComponent(file.name)}`,
          file,
          'application/octet-stream',
        );
        if (!up.ok) return up;
        uploaded.current.set(file, up.data.id);
        outputIds.push(up.data.id);
      }
      return api<Task>('POST', '/api/tasks', {
        requestId: requestId.current,
        instruction: instruction.trim(),
        ...(agentId ? { agentId } : {}),
        ...(goalId ? { goalId } : {}),
        // 파일을 붙였거나 페이지로 받으면 만들기 일: 칸에서 파일을 읽고 결과물(문서 · 표 · 페이지)을 만든다
        ...(asPage || outputIds.length > 0 ? { kind: 'make' } : {}),
        ...(outputIds.length > 0 ? { materials: { outputIds, wikiIds: [] } } : {}),
        ...(asPage ? { page: {} } : {}),
      });
    });
    if (!reply?.ok) return;
    requestId.current = null;
    setInstruction('');
    setAgentId('');
    setGoalId('');
    setAsPage(false);
    setFiles([]);
    uploaded.current.clear();
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
        <label className="ghost file-pick">
          파일 붙이기
          <input
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              e.target.value = '';
              edit(() =>
                setFiles((now) => {
                  // 같은 파일을 두 번 고르면 하나만
                  const seen = new Set(now.map(fileKey));
                  return [...now, ...picked.filter((f) => !seen.has(fileKey(f)))].slice(
                    0,
                    FILES_MAX,
                  );
                }),
              );
            }}
          />
        </label>
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
      {files.length > 0 && (
        <ul className="ask-files">
          {files.map((file, i) => (
            <li key={fileKey(file)}>
              {file.name}
              <button
                type="button"
                className="ghost"
                aria-label={`${file.name} 빼기`}
                onClick={() => edit(() => setFiles((now) => now.filter((_, j) => j !== i)))}
              >
                빼기
              </button>
            </li>
          ))}
          <li className="note">
            파일은 결과물로 올라가고, 만들기 에이전트가 읽어 결과를 만들어요 (최대 {FILES_MAX}개)
          </li>
        </ul>
      )}
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
