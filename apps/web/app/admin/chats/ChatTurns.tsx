import Link from 'next/link';
import { ApprovalDetail } from '../../_task/ApprovalDetail';
import { clock, NEWS_KINDS, OUTPUT_KINDS } from '../../_task/labels';
import { MarkdownText } from '../../_task/MarkdownText';
import { OutputOpen } from '../../_task/parts';
import type { ChatNews, ChatTurn } from '../../_task/types';

/** 일하는 중인 회차의 상태 */
const OPEN = ['queued', 'running', 'waiting'];
/** 맡기 전의 주고받음 (첫 메시지 바로 아래): 질문 · 맡음, 그리고 회차 작업이 없는 덧붙인 말(질문에 글로 한 답) */
const BEFORE = ['question', 'routed'];
/** 회차의 과정 (접어 둔다): 팀이 남긴 소식. 덧붙인 말 · 짧은 답은 말풍선으로, 최종 답 · 실패는 답 자체라 뺀다 */
const PROCESS = ['progress', 'decision', 'assumption', 'member_done', 'member_failed', 'review'];

const isBefore = (n: ChatNews) =>
  BEFORE.includes(n.kind) || (n.kind === 'appended' && n.taskId === null);

// 대화의 주고받음 (2차 1-5, ChatGPT · Claude 같은 모양): 관리자의 말풍선(오른쪽)과 답(왼쪽).
// 맡기 전에는 첫 메시지(pending)와 질문 · 답, 맡은 뒤에는 회차마다 메시지 → 덧붙인 말 · 짧은 답 → 과정(접힘) → 답.
// 팀이 무엇을 하는지는 과정을 펼쳐야 보인다. 결과 카드에 싣지 않는 결재(사이트 로그인 등)만 답 아래에 둔다
export function ChatTurns({
  turns,
  news,
  pending,
  me,
  partner,
  busy,
  onCancel,
}: {
  turns: readonly ChatTurn[];
  news: readonly ChatNews[];
  /** 맡기 전의 첫 메시지 (맡았으면 null) */
  pending: string | null;
  me: string;
  /** 맡은 에이전트 (맡기 전이면 null) */
  partner: string | null;
  /** 지금 취소하는 회차의 작업 id */
  busy: string | null;
  onCancel: (taskId: string, version: number) => void;
}) {
  const before = news.filter(isBefore);
  return (
    <ol className="chat-log" aria-label="대화 내용">
      {pending !== null && turns.length === 0 && (
        <li className="chat-turn">
          <Mine who={me} text={pending} />
          <Before items={before} me={me} />
        </li>
      )}
      {turns.map((t, i) => {
        const next = turns[i + 1]?.createdAt ?? null;
        const within = news.filter(
          (n) =>
            !isBefore(n) && n.createdAt >= t.createdAt && (next === null || n.createdAt < next),
        );
        return (
          <li key={t.taskId} className="chat-turn">
            <Mine
              who={t.fix ? '검사 · 받을 것이 없어 다시 맡김' : t.fromDevice ? '기기의 AI 도구' : me}
              at={t.createdAt}
              text={t.message}
            />
            {i === 0 && <Before items={before} me={me} />}
            {within
              .filter((n) => n.kind === 'appended' || n.kind === 'reply')
              .map((n) =>
                n.kind === 'appended' ? (
                  <Mine key={n.n} who={me} at={n.createdAt} text={n.text} />
                ) : (
                  <div key={n.n} className="bubble theirs">
                    <span className="bubble-meta">
                      {n.agent ?? partner} · {clock(n.createdAt)}
                    </span>
                    <p className="text">{n.text}</p>
                  </div>
                ),
              )}
            <Process turn={t} items={within.filter((n) => PROCESS.includes(n.kind))} />
            <div className="bubble theirs" aria-live={t.finishedAt ? undefined : 'polite'}>
              <span className="bubble-meta">
                {partner ?? '에이전트'}
                {t.finishedAt ? ` · ${clock(t.finishedAt)}` : ''}
              </span>
              <Reply turn={t} />
              {t.outputs.length > 0 && (
                <ul className="list" aria-label="결과물">
                  {t.outputs.map((o) => (
                    <li key={o.id} className="list-cell output-row">
                      <div className="output-main">
                        <b>{o.name}</b>
                        <small>{OUTPUT_KINDS[o.kind] ?? o.kind}</small>
                      </div>
                      <OutputOpen id={o.id} name={o.name} />
                    </li>
                  ))}
                </ul>
              )}
              {(t.status === 'queued' || t.status === 'running') && (
                <div className="row">
                  <button
                    type="button"
                    className="ghost small"
                    disabled={busy !== null}
                    onClick={() => onCancel(t.taskId, t.taskVersion)}
                  >
                    {busy === t.taskId ? '취소하는 중' : '이 답 취소'}
                  </button>
                </div>
              )}
            </div>
            {t.approvalIds.map((id) => (
              <div key={id} className="chat-approval">
                <ApprovalDetail id={id} />
              </div>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

function Mine({ who, at, text }: { who: string; at?: string; text: string }) {
  return (
    <div className="bubble mine">
      <span className="bubble-meta">
        {who}
        {at ? ` · ${clock(at)}` : ''}
      </span>
      <p className="text">{text}</p>
    </div>
  );
}

/** 맡기 전의 주고받음: 질문(지금 질문의 고를 것은 아래 ChatQuestion) · 글로 한 답 · 맡음 */
function Before({ items, me }: { items: readonly ChatNews[]; me: string }) {
  return items.map((n) =>
    n.kind === 'appended' ? (
      <Mine key={n.n} who={me} at={n.createdAt} text={n.text} />
    ) : n.kind === 'question' ? (
      <div key={n.n} className="bubble theirs">
        <span className="bubble-meta">질문 · {clock(n.createdAt)}</span>
        <p className="text">{n.text}</p>
      </div>
    ) : (
      <p key={n.n} className="chat-event">
        맡음 · {n.agent}
        {n.text && n.text !== n.agent ? ` · ${n.text}` : ''}
      </p>
    ),
  );
}

/** 회차의 과정: 접어 둔다. 돌면 "일하는 중", 끝나면 "과정". 펼치면 팀이 남긴 소식과 작업 */
function Process({ turn: t, items }: { turn: ChatTurn; items: readonly ChatNews[] }) {
  const open = OPEN.includes(t.status);
  if (!open && items.length === 0) return null;
  // 지금 하는 일 한 줄은 도는 동안만 (결재를 기다리는 동안의 기록은 결재 요청이라 카드가 대신 보인다)
  const doing =
    t.status === 'running'
      ? (t.progress ?? (t.openSubtasks > 0 ? `팀원 ${t.openSubtasks}명이 일하는 중` : null))
      : null;
  return (
    <details className="chat-process">
      <summary>
        {open ? '일하는 중' : '과정'}
        {items.length > 0 ? ` · 소식 ${items.length}개` : ''}
        {doing ? ` · ${doing}` : ''}
      </summary>
      <ol>
        {items.map((n) => (
          <li key={n.n}>
            <small>
              {NEWS_KINDS[n.kind] ?? n.kind}
              {n.agent ? ` · ${n.agent}` : ''} · {clock(n.createdAt)}
            </small>
            <span>{n.text}</span>
          </li>
        ))}
      </ol>
      <Link className="note" href={`/admin/tasks/${t.taskId}`}>
        작업 보기
      </Link>
    </details>
  );
}

/** 답: 끝났으면 글, 아니면 지금 상태 한 줄 */
function Reply({ turn: t }: { turn: ChatTurn }) {
  if (t.status === 'done')
    // 결재한 일을 서버가 실행해 끝난 회차에는 글 답이 없다
    return t.reply?.trim() ? <MarkdownText text={t.reply} /> : <p className="note">완료</p>;
  if (t.status === 'failed') return <p className="error">{t.error ?? '실패'}</p>;
  if (t.status === 'cancelled') return <p className="note">멈춤</p>;
  const doing =
    t.status === 'queued'
      ? '곧 시작해요'
      : t.waitReason === 'approval'
        ? '결재를 기다려요 · 아래 결과 카드에서 정하면 이어서 해요'
        : '일하는 중…';
  return <p className="note">{doing}</p>;
}
