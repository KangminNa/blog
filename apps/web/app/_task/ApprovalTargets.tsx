'use client';

import Link from 'next/link';
import { POST_STATUS_LABELS } from '../_blog/labels';
import type { EditablePost } from '../_blog/types';
import { api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import { CHECKPOINTS, GOAL_COMPLETE, GOAL_RUN_STATUS, TARGET_LABELS, tokens } from './labels';
import { useGoalRun } from './live';
import { Criteria, RoundReport } from './RoundReport';
import type { Agent, Approval, CodePull } from './types';

// 결재 화면의 "무엇을 결재하는지" 칸 가운데 글 · 한도가 아닌 것. 대상은 서버에서 읽는다 (에이전트의 메모가 아니라).

/**
 * 목표 실행의 결재문: 이번 회차의 보고와 완료 조건. 왜 결재가 올라왔는지는 요청 메모에 있다.
 * 보고는 팀장(AI)의 주장이라 근거와 회차 작업을 함께 보여 준다
 */
export function GoalRunTarget({ approval }: { approval: Approval }) {
  const run = useGoalRun(approval.target.id);
  const r = run.data;
  if (!r)
    return run.error ? (
      <p className="error">{run.error}</p>
    ) : (
      <p className="label-mono">목표 실행 불러오는 중…</p>
    );
  const asking = r.pendingApprovalId === approval.id;
  const report = asking ? r.rounds.find((x) => x.round === r.round) : undefined;
  return (
    <section className="preview" aria-label="결재문">
      <b>
        {r.title} · {r.round}회차 (한도 {r.maxRounds})
      </b>
      <p className="note">
        목표 {r.goalTitle ?? '–'} · 팀장 {r.agentName ?? '–'} · 결재{' '}
        {CHECKPOINTS[r.checkpoint] ?? r.checkpoint}
      </p>
      {!asking ? (
        <p className="note">정해진 결재. 실행은 지금 {GOAL_RUN_STATUS[r.status] ?? r.status}</p>
      ) : report ? (
        <RoundReport round={report} />
      ) : (
        <p className="warn">이번 회차 보고 없음</p>
      )}
      <b>완료 조건</b>
      <Criteria criteria={r.criteria} />
      {asking && (
        <p>
          {approval.action === GOAL_COMPLETE
            ? '승인하면 목표 실행을 완료로 닫아요.'
            : '승인하면 다음 회차로 가요 (한도에 닿았으면 한 회차 늘려요).'}{' '}
          수정 요청은 메모를 다음 회차의 지시로 넘기고, 반려하면 멈춰요
        </p>
      )}
      <div>
        <Link className="ghost" href={`/admin/goals/runs/${r.id}`}>
          목표 실행 열기 · 보고 {r.rounds.length}개
        </Link>
      </div>
    </section>
  );
}

/** code.pr.merge: 패키지가 기록한 PR (에이전트의 메모가 아니라). 결재 뒤 PR이 바뀌었으면 알린다 */
export function PullTarget({ approval }: { approval: Approval }) {
  const { id, version } = approval.target;
  const { data: pull, error } = useLiveValue(
    `pull:${id}`,
    () => api<CodePull>('GET', `/api/p/code-github/pulls/${id}`),
    [],
  );

  if (error) return <p className="error">{error}</p>;
  if (!pull) return <p className="label-mono">PR 불러오는 중…</p>;
  const failed = pull.checks.filter((c) => !c.ok);
  return (
    <section className="preview" aria-label="PR">
      <b>
        <a href={pull.url} target="_blank" rel="noreferrer">
          {pull.repoName} #{pull.number}
        </a>
      </b>
      {pull.version !== version && (
        <p className="warn">
          결재 뒤 PR이 바뀌었어요 (판 {version} → {pull.version}). 승인해도 머지로 남지 않아요
        </p>
      )}
      <dl className="kv">
        <dt>브랜치</dt>
        <dd>{pull.branch}</dd>
        <dt>커밋</dt>
        <dd>{pull.headSha.slice(0, 7)}</dd>
        <dt>검사</dt>
        <dd>
          {pull.checks.length === 0
            ? '검사 명령 없음'
            : failed.length === 0
              ? `${pull.checks.length}개 통과`
              : `실패: ${failed.map((c) => c.command).join(', ')}`}
        </dd>
      </dl>
    </section>
  );
}

export function OtherTarget({ approval }: { approval: Approval }) {
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

export function PostTarget({
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

export function LimitTarget({ approval, agent }: { approval: Approval; agent: Agent | null }) {
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
