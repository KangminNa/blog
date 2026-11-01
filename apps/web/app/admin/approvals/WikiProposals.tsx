'use client';

import '../../_vault/vault.css';
import { useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { when } from '../../_task/labels';
import { useGraph, useWaitingChanges } from '../../_vault/live';
import type { ChangeSet, WaitingChange } from '../../_vault/types';
import { useNotify } from '../AdminShell';

const OP_LABELS: Record<string, string> = {
  'wiki.create': '위키 만들기',
  'wiki.revise': '위키 고치기',
  'session.assign': '대표 위키 정하기',
  'edge.add': '연결 더하기',
  'edge.remove': '연결 지우기',
  'category.create': '카테고리 만들기',
  'category.assign': '카테고리 정하기',
};
const EDGE_LABELS: Record<string, string> = { material: '재료', link: '링크', similar: '비슷함' };
/** 변경의 내용 중 다른 점을 가리키는 칸: 화면 이름 */
const REFS: readonly (readonly [string, string])[] = [
  ['wiki_id', '위키'],
  ['category_id', '카테고리'],
  ['src', '시작'],
  ['dst', '끝'],
];

// 결재 메뉴의 위키 제안: AI의 변경 중 검토를 기다리는 것. 데이터는 vault가 갖고, 결정도 vault의 경로로 한다.
export function WikiProposals() {
  const waiting = useWaitingChanges();
  const graph = useGraph();
  const labelOf = (id: unknown) =>
    graph.data?.nodes.find((n) => n.id === id)?.label || String(id ?? '');

  if (waiting.data === null)
    return waiting.error ? (
      <p className="error">{waiting.error}</p>
    ) : (
      <p className="label-mono">불러오는 중…</p>
    );
  if (waiting.data.changes.length === 0)
    return <p className="rows-empty">기다리는 위키 제안 없음</p>;

  return (
    <div>
      {waiting.error && <p className="error">{waiting.error}</p>}
      {waiting.data.changes.map((c) => (
        <Proposal
          key={`${c.setId}:${c.seq}`}
          change={c}
          labelOf={labelOf}
          reload={waiting.reload}
        />
      ))}
    </div>
  );
}

function Proposal({
  change: c,
  labelOf,
  reload,
}: {
  change: WaitingChange;
  labelOf: (id: unknown) => string;
  reload: () => Promise<void>;
}) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = (c.payload ?? {}) as Record<string, unknown>;
  const title = typeof payload.title === 'string' ? payload.title : null;
  const body = typeof payload.body_md === 'string' ? payload.body_md : null;
  const edge = typeof payload.kind === 'string' ? payload.kind : null;
  const refs = REFS.filter(([key]) => payload[key]);

  async function decide(decision: 'approve' | 'decline') {
    setBusy(true);
    setError(null);
    const reply = await api<ChangeSet>('POST', `/api/changes/${c.setId}/ops/${c.seq}/decide`, {
      version: c.version,
      decision,
    });
    setBusy(false);
    if (!reply.ok) {
      setError(describe(reply.error));
      await reload();
      return;
    }
    const op = reply.data.ops.find((o) => o.seq === c.seq);
    notify(op?.status === 'superseded' ? '그사이 대상이 바뀌어 넘어갔어요' : '결정했어요');
    await reload();
  }

  return (
    <article className="panel proposal" aria-label={OP_LABELS[c.op] ?? c.op}>
      <div className="page-head">
        <div className="page-title">
          <span className="note">
            {c.actorType === 'ai' ? '에이전트' : 'AI 도구'} · {when(c.createdAt)}
          </span>
          <h2>{title ?? OP_LABELS[c.op] ?? c.op}</h2>
        </div>
        <span className="pill">대기</span>
      </div>
      {c.reason && <p className="warn">{c.reason}</p>}
      <dl className="kv">
        <dt>변경</dt>
        <dd>{OP_LABELS[c.op] ?? c.op}</dd>
        {c.message && (
          <>
            <dt>이유</dt>
            <dd className="text">{c.message}</dd>
          </>
        )}
        {c.target.id && (
          <>
            <dt>대상</dt>
            <dd>{labelOf(c.target.id)}</dd>
          </>
        )}
        {edge && (
          <>
            <dt>종류</dt>
            <dd>{EDGE_LABELS[edge] ?? edge}</dd>
          </>
        )}
        {refs.map(([key, label]) => (
          <div key={key} style={{ display: 'contents' }}>
            <dt>{label}</dt>
            <dd>{labelOf(payload[key])}</dd>
          </div>
        ))}
      </dl>
      {body !== null && <pre className="proposal-body">{body}</pre>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button
          type="button"
          className="cta small"
          disabled={busy}
          onClick={() => decide('approve')}
        >
          승인
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => decide('decline')}>
          거절
        </button>
      </div>
    </article>
  );
}
