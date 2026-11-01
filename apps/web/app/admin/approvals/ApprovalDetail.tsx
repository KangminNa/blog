'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import { type EditablePost, POST_STATUS_LABELS } from '../../_lib/types';
import { useLiveValue } from '../../_lib/use-live';
import {
  actionLabel,
  PUBLISH_POST,
  RAISE_LIMIT,
  TARGET_LABELS,
  TASK_STATUS,
  tokens,
  when,
} from '../../_task/labels';
import { APPROVAL_TOPICS, useAgents } from '../../_task/live';
import { ApprovalPill } from '../../_task/parts';
import type { Agent, Approval, TaskDetail } from '../../_task/types';
import { useNotify } from '../AdminShell';

const DONE_NOTES: Record<string, string> = {
  approve: '승인됨',
  revise: '수정 요청 전달됨',
  reject: '반려됨',
};
const SEALS: Record<string, string> = {
  approved: '승인',
  rejected: '반려',
  revision_requested: '수정',
  cancelled: '취소',
};
const NO_VALUE = { ok: true, data: null } as const;

// 결재 하나. 판단은 에이전트의 메모가 아니라 서버에서 읽은 대상 내용으로 한다.
export function ApprovalDetail({ id }: { id: string }) {
  const approval = useLiveValue(
    `approval:${id}`,
    () => api<Approval>('GET', `/api/approvals/${id}`),
    APPROVAL_TOPICS,
    id,
  );
  const a = approval.data;
  const agents = useAgents();

  if (!a)
    return approval.status === 404 ? (
      <p className="rows-empty">찾을 수 없는 결재</p>
    ) : approval.error ? (
      <p className="error">{approval.error}</p>
    ) : (
      <p className="label-mono">불러오는 중…</p>
    );

  return (
    <Loaded
      approval={a}
      agents={agents.data?.agents ?? null}
      reload={approval.reload}
      problem={approval.error}
    />
  );
}

function Loaded({
  approval: a,
  agents,
  reload,
  problem,
}: {
  approval: Approval;
  agents: readonly Agent[] | null;
  reload: () => Promise<void>;
  problem: string | null;
}) {
  const isPost = a.action === PUBLISH_POST;
  const post = useLiveValue<EditablePost | null>(
    isPost ? `post:${a.target.id}` : 'no-post',
    () =>
      isPost ? api<EditablePost>('GET', `/api/posts/${a.target.id}`) : Promise.resolve(NO_VALUE),
    ['blog.post.*'],
    isPost ? a.target.id : undefined,
  );
  const task = useLiveValue<TaskDetail | null>(
    a.taskId ? `task:${a.taskId}` : 'no-task',
    () => (a.taskId ? api<TaskDetail>('GET', `/api/tasks/${a.taskId}`) : Promise.resolve(NO_VALUE)),
    ['task.task.changed'],
    a.taskId ?? undefined,
  );
  /**
   * 임시 글은 저장해도 신호가 없어(blog.post.updated는 공개 글만) 화면이 옛 내용일 수 있다.
   * 승인 직전에 다시 읽어 보던 내용과 다르면 멈춘다: 읽지 않은 내용을 승인하지 않게.
   */
  async function unchanged(): Promise<boolean> {
    if (!isPost) return true;
    const fresh = await api<EditablePost>('GET', `/api/posts/${a.target.id}`);
    const same = fresh.ok && fresh.data.version === post.data?.version;
    if (!same) await post.reload();
    return same;
  }

  const agent = agents?.find((x) => x.id === a.agentId);
  const limitAgent = a.action === RAISE_LIMIT ? agents?.find((x) => x.id === a.target.id) : null;
  const heading =
    isPost && post.data
      ? post.data.title
      : limitAgent
        ? `${limitAgent.name} 월 한도`
        : actionLabel(a.action);

  return (
    <article className="panel" aria-label={heading}>
      <div className="page-head">
        <div className="page-title">
          {heading !== actionLabel(a.action) && (
            <span className="note">{actionLabel(a.action)}</span>
          )}
          <h2>{heading}</h2>
        </div>
        <ApprovalPill status={a.status} />
      </div>
      <Stamps approval={a} requester={agent?.name ?? '서버'} />
      {isPost ? (
        <PostTarget approval={a} post={post.data} status={post.status} error={post.error} />
      ) : a.action === RAISE_LIMIT ? (
        <LimitTarget approval={a} agent={limitAgent ?? null} />
      ) : (
        <OtherTarget approval={a} />
      )}
      <dl className="kv">
        <dt>요청</dt>
        <dd>{agent ? `${agent.name} 에이전트` : '서버'}</dd>
        <dt>시각</dt>
        <dd>{when(a.createdAt)}</dd>
        {a.decidedAt && (
          <>
            <dt>결정</dt>
            <dd>{when(a.decidedAt)}</dd>
          </>
        )}
        {a.note && (
          <>
            {/* 결정하며 남긴 말이 있으면 서버가 요청 메모를 덮는다 (요청 메모는 실행 로그에 남는다) */}
            <dt>{a.status === 'pending' ? '요청 메모' : '메모'}</dt>
            <dd className="text">{a.note}</dd>
          </>
        )}
        {a.taskId && (
          <>
            <dt>관련 작업</dt>
            <dd>
              <Link href={`/admin/tasks/${a.taskId}`}>{task.data?.title ?? '작업 열기'}</Link>
              {task.data ? ` · ${TASK_STATUS[task.data.status] ?? task.data.status}` : ''}
            </dd>
          </>
        )}
      </dl>
      {problem && <p className="error">{problem}</p>}
      {a.status === 'pending' && (
        <Decide
          approval={a}
          canApprove={!isPost || (post.data !== null && post.error === null)}
          unchanged={unchanged}
          reload={reload}
        />
      )}
    </article>
  );
}

/** 결재선: 요청 → 결재 */
function Stamps({ approval, requester }: { approval: Approval; requester: string }) {
  const seal = SEALS[approval.status];
  return (
    <div className="stamps" role="img" aria-label={`요청 ${requester}, 결재 ${seal ?? '대기'}`}>
      <div className="stamp-cell">
        <span>요청</span>
        <div>{requester}</div>
      </div>
      <div className="stamp-cell">
        <span>결재</span>
        <div>
          <span className={seal ? 'seal' : 'seal blank'}>{seal ?? '대기'}</span>
        </div>
      </div>
    </div>
  );
}

function PostTarget({
  approval,
  post,
  status,
  error,
}: {
  approval: Approval;
  post: EditablePost | null;
  status: number | null;
  error: string | null;
}) {
  if (!post)
    return status === 404 ? (
      <p className="warn">대상 글 없음 ({approval.target.id})</p>
    ) : error ? (
      <p className="error">{error}</p>
    ) : (
      <p className="label-mono">글 읽는 중…</p>
    );
  const moved = post.version !== approval.target.version;
  return (
    <>
      {moved && (
        <p className="warn">
          요청 뒤 바뀐 글 (요청 버전 {approval.target.version} · 지금 버전 {post.version})
        </p>
      )}
      {post.deletedAt && <p className="warn">휴지통에 있는 글</p>}
      <section className="preview" aria-label="실행 내용">
        <b>실행 내용</b>
        <p>
          공개 범위: {POST_STATUS_LABELS[post.status]}에서 공개로.
          {post.tags.length > 0 ? ` 태그: ${post.tags.join(', ')}.` : ''} 본문{' '}
          {post.body.length.toLocaleString('ko-KR')}자.
        </p>
        <pre className="raw">{post.body}</pre>
      </section>
      <div>
        <Link className="ghost" href={`/admin/posts/${post.id}`}>
          편집기에서 열기
        </Link>
      </div>
    </>
  );
}

function LimitTarget({ approval, agent }: { approval: Approval; agent: Agent | null }) {
  if (!agent) return <OtherTarget approval={approval} />;
  const limit = agent.monthlyLimit;
  return (
    <section className="preview" aria-label="실행 내용">
      <b>실행 내용</b>
      <dl className="kv">
        <dt>이번 달 사용량</dt>
        <dd>{tokens(agent.usedThisMonth)} 토큰</dd>
        <dt>월 한도</dt>
        <dd>{limit === null ? '한도 없음' : `${tokens(limit)} 토큰`}</dd>
      </dl>
      {approval.status === 'pending' && (
        <p>
          승인하면 월 한도가 2배{limit === null ? '' : ` (${tokens(limit * 2)} 토큰)`}로 바뀌고
          에이전트가 재개돼요
        </p>
      )}
    </section>
  );
}

function OtherTarget({ approval }: { approval: Approval }) {
  const { kind, id, version } = approval.target;
  return (
    <section className="preview" aria-label="실행 내용">
      <b>실행 내용</b>
      <dl className="kv">
        <dt>종류</dt>
        <dd>{TARGET_LABELS[kind] ?? kind}</dd>
        <dt>ID</dt>
        <dd>{id}</dd>
        <dt>버전</dt>
        <dd>{version}</dd>
      </dl>
    </section>
  );
}

function Decide({
  approval,
  canApprove,
  unchanged,
  reload,
}: {
  approval: Approval;
  canApprove: boolean;
  unchanged: () => Promise<boolean>;
  reload: () => Promise<void>;
}) {
  const notify = useNotify();
  const [note, setNote] = useState('');
  const [noteProblem, setNoteProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteBox = useRef<HTMLTextAreaElement>(null);

  async function decide(decision: string) {
    setProblem(null);
    if (decision === 'revise' && !note.trim()) {
      setNoteProblem('고칠 내용을 적어 주세요');
      noteBox.current?.focus();
      return;
    }
    setNoteProblem(null);
    setBusy(true);
    if (decision === 'approve' && !(await unchanged())) {
      setBusy(false);
      return setProblem('바뀐 글이에요. 달라진 내용을 확인한 뒤 다시 승인해 주세요');
    }
    const reply = await api<Approval>('POST', `/api/approvals/${approval.id}/decide`, {
      version: approval.version,
      decision,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    await reload();
    setBusy(false);
    if (reply.ok) return notify(DONE_NOTES[decision] ?? '결정됨');
    setProblem(
      reply.status === 409
        ? '이미 바뀐 결재예요. 최신 내용을 다시 읽었어요'
        : describe(reply.error),
    );
  }

  return (
    <div className="decide">
      <div className="field">
        <label htmlFor="approval-note">메모</label>
        <textarea
          ref={noteBox}
          id="approval-note"
          className="input"
          rows={2}
          value={note}
          aria-invalid={noteProblem !== null}
          aria-describedby="approval-note-help"
          onChange={(e) => {
            setNote(e.target.value);
            setNoteProblem(null);
          }}
        />
        <small id="approval-note-help">수정 요청에는 필수</small>
        {noteProblem && <p className="error">{noteProblem}</p>}
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button
          type="button"
          className="cta small"
          disabled={busy || !canApprove}
          onClick={() => decide('approve')}
        >
          승인
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => decide('revise')}>
          수정 요청
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => decide('reject')}>
          반려
        </button>
      </div>
    </div>
  );
}
