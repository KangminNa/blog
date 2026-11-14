'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { useAgents } from '../../_task/live';
import type { Output, Task } from '../../_task/types';
import type { WikiPage, WikiSummary } from '../../_vault/types';

/** 결과물 · 위키 각각 (서버의 MakeMaterials.MAX와 맞춘다) */
const MATERIALS_MAX = 10;

/** 맡길 때 보내는 본문 (POST /api/tasks). requestId는 패널이 붙인다 */
export type MakeBody = {
  kind: 'make';
  instruction: string;
  agentId?: string;
  materials: { outputIds: readonly string[]; wikiIds: readonly string[] };
};

// 만들기 작업 (결과물 2차): 코드 러너 칸에서 AI가 셸로 PPT · 문서 · 영상을 만든다.
// 재료는 주인이 고른 결과물 파일과 위키뿐이다. 고른 비공개 위키도 칸 안의 AI가 읽는다 (작업 토큰에 그 위키만 읽기 허락).
// "고쳐 달라"는 앞 결과물을 재료로 넣은 새 작업이다.
// 폼은 칸의 상태와 보낼 본문을 가진다. 맡기기는 패널이 돌리고 (onSubmit), 위키 찾기만 누를 때 여기서 읽는다.
export function MakeForm({
  materials,
  onRemove,
  revising,
  busy,
  problem,
  onSubmit,
  onClear,
  onClose,
}: {
  /** 재료로 고른 결과물 (목록에서 더한다) */
  materials: readonly Output[];
  onRemove: (output: Output) => void;
  /** 고쳐 달라로 열렸으면 그 결과물 */
  revising: Output | null;
  busy: boolean;
  /** 맡기기의 오류 문구 */
  problem: string | null;
  /** 맡긴다. 됐으면 그 작업 */
  onSubmit: (body: MakeBody, requestId: string) => Promise<Task | null>;
  /** 맡기기의 오류 문구를 지운다 (칸을 고쳤거나 찾기의 오류를 보일 때) */
  onClear: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const agents = useAgents();
  const makers = (agents.data?.agents ?? []).filter((a) => a.scopes.includes('make'));
  const [instruction, setInstruction] = useState('');
  const [agentId, setAgentId] = useState('');
  const [wikis, setWikis] = useState<readonly WikiSummary[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<readonly WikiSummary[] | null>(null);
  /** 위키 찾기의 오류 문구 */
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<Task | null>(null);
  // 같은 내용을 다시 보내면 같은 requestId: 응답을 놓쳐 다시 눌러도 작업은 하나다
  const requestId = useRef<string | null>(null);

  // 재료가 바뀌면 다른 요청이다
  // biome-ignore lint/correctness/useExhaustiveDependencies: 재료가 바뀔 때 requestId만 새로 만든다
  useEffect(() => {
    requestId.current = null;
  }, [materials, wikis]);

  function edit(apply: () => void) {
    requestId.current = null;
    setError(null);
    onClear();
    setMade(null);
    apply();
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    const reply = await api<WikiPage>('GET', `/api/wikis?${new URLSearchParams(q ? { q } : {})}`);
    if (!reply.ok) {
      onClear();
      return setError(describe(reply.error));
    }
    setFound(reply.data.wikis);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    requestId.current ??= crypto.randomUUID();
    const task = await onSubmit(
      {
        kind: 'make',
        instruction: instruction.trim(),
        ...(agentId ? { agentId } : {}),
        materials: { outputIds: materials.map((o) => o.id), wikiIds: wikis.map((w) => w.id) },
      },
      requestId.current,
    );
    if (!task) return;
    requestId.current = null;
    setInstruction('');
    setMade(task);
  }

  const fullWikis = wikis.length >= MATERIALS_MAX;

  return (
    <form className="panel stack" aria-label="만들기" onSubmit={submit}>
      <div className="sec-title flat">
        <h2>{revising ? `수정 요청: ${revising.name}` : '만들기'}</h2>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      <p className="note">
        코드 러너 칸에서 AI가 PPT · 문서 · 영상을 만들어 결과물로 올려요. 고른 재료는 칸 안의 AI가
        읽어요
      </p>
      <div className="field">
        <label htmlFor={`${id}-text`}>{revising ? '고칠 점' : '만들 것'}</label>
        <textarea
          id={`${id}-text`}
          className="input"
          rows={3}
          value={instruction}
          placeholder={
            revising ? '예: 표지 제목을 줄이고 3쪽 표를 그래프로' : '예: 이 위키로 10쪽 발표 자료'
          }
          onChange={(e) => edit(() => setInstruction(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-who`}>담당</label>
        <select
          id={`${id}-who`}
          className="input"
          value={agentId}
          onChange={(e) => edit(() => setAgentId(e.target.value))}
        >
          <option value="">자동 배정 (파일 만들기 권한)</option>
          {makers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.status === 'paused' ? `${a.name} (중지)` : a.name}
            </option>
          ))}
        </select>
        {agents.data && makers.length === 0 && (
          <small className="warn">
            파일 만들기 권한이 있는 에이전트가 없어요. <Link href="/admin/agents">에이전트</Link>
            에서 권한을 주세요
          </small>
        )}
      </div>
      <div className="field">
        <span>
          재료 결과물 ({materials.length}/{MATERIALS_MAX})
        </span>
        {materials.length === 0 ? (
          <small>아래 목록의 "재료로"로 더해요</small>
        ) : (
          <ul className="picked" aria-label="재료 결과물">
            {materials.map((o) => (
              <li key={o.id} className="chip">
                {o.name}
                <button
                  type="button"
                  className="unpick"
                  aria-label={`${o.name} 빼기`}
                  onClick={() => edit(() => onRemove(o))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="field">
        <span>
          재료 위키 ({wikis.length}/{MATERIALS_MAX})
        </span>
        {wikis.length > 0 && (
          <ul className="picked" aria-label="재료 위키">
            {wikis.map((w) => (
              <li key={w.id} className="chip">
                {w.title}
                {w.visibility === 'private' ? ' (비공개)' : ''}
                <button
                  type="button"
                  className="unpick"
                  aria-label={`${w.title} 빼기`}
                  onClick={() => edit(() => setWikis(wikis.filter((x) => x.id !== w.id)))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <input
            className="input pick-query"
            aria-label="위키 찾기"
            placeholder="위키 제목 · 본문으로 찾기"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search(e);
            }}
          />
          <button type="button" className="ghost" onClick={search}>
            찾기
          </button>
        </div>
        {found !== null &&
          (found.length === 0 ? (
            <small>찾은 위키 없음</small>
          ) : (
            <ul className="list" aria-label="찾은 위키">
              {found.map((w) => {
                const picked = wikis.some((x) => x.id === w.id);
                return (
                  <li key={w.id} className="list-cell pick">
                    <span>
                      {w.title}
                      {w.visibility === 'private' ? ' (비공개)' : ''}
                    </span>
                    <button
                      type="button"
                      className="ghost"
                      disabled={picked || fullWikis}
                      onClick={() => edit(() => setWikis([...wikis, w]))}
                    >
                      {picked ? '고름' : '재료로'}
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}
      </div>
      {(problem ?? error) && <p className="error">{problem ?? error}</p>}
      {made && (
        <p className="note" role="status">
          맡겼어요 · <Link href={`/admin/tasks/${made.id}`}>작업 보기</Link>
        </p>
      )}
      <div className="row">
        <span className="spacer" />
        <button type="submit" className="cta small" disabled={busy || !instruction.trim()}>
          맡기기
        </button>
      </div>
    </form>
  );
}
