import Link from 'next/link';
import { ApprovalDetail } from '../../_task/ApprovalDetail';
import { clock, OUTPUT_KINDS } from '../../_task/labels';
import { MarkdownText } from '../../_task/MarkdownText';
import { OutputOpen } from '../../_task/parts';
import type { ChatTurn } from '../../_task/types';

// 대화의 회차들: 관리자의 말풍선(오른쪽)과 상대의 말풍선(왼쪽).
// 상대의 답은 작업의 상태를 따라간다: 대기 → 생각 중(진행 기록) → 팀에게 맡김 · 결재 대기 → 답 · 실패 · 멈춤.
// 결과 카드에 싣지 않는 결재(바로 알리는 동작: 사이트 로그인 등)만 결재 화면과 같은 칸을 말풍선 아래에 둔다.
// 대화의 다른 결재는 결과 카드에서 정한다 (2차 2단계, ChatCardForm).
export function ChatTurns({
  turns,
  me,
  partner,
  busy,
  onCancel,
}: {
  turns: readonly ChatTurn[];
  me: string;
  partner: string;
  /** 지금 취소하는 회차의 작업 id */
  busy: string | null;
  onCancel: (taskId: string, version: number) => void;
}) {
  if (turns.length === 0) return <p className="note">아직 보낸 메시지 없음</p>;
  return (
    <ol className="chat-log" aria-label="대화 내용">
      {turns.map((t) => (
        <li key={t.taskId} className="chat-turn">
          <div className="bubble mine">
            <span className="bubble-meta">
              {t.fix ? '검사 · 받을 것이 없어 다시 맡김' : t.fromDevice ? '기기의 AI 도구' : me} ·{' '}
              {clock(t.createdAt)}
            </span>
            <p className="text">{t.message}</p>
          </div>
          <div className="bubble theirs" aria-live={t.finishedAt ? undefined : 'polite'}>
            <span className="bubble-meta">
              {partner}
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
            <div className="row">
              <Link className="note" href={`/admin/tasks/${t.taskId}`}>
                작업 보기
              </Link>
              {['queued', 'running', 'waiting'].includes(t.status) && (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy !== null}
                  onClick={() => onCancel(t.taskId, t.taskVersion)}
                >
                  {busy === t.taskId ? '취소하는 중' : '취소'}
                </button>
              )}
            </div>
          </div>
          {t.approvalIds.map((id) => (
            <div key={id} className="chat-approval">
              <ApprovalDetail id={id} />
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** 상대의 답: 끝났으면 글, 아니면 지금 하는 일 */
function Reply({ turn: t }: { turn: ChatTurn }) {
  if (t.status === 'done')
    // 결재한 일을 서버가 실행해 끝난 회차에는 글 답이 없다
    return t.reply?.trim() ? <MarkdownText text={t.reply} /> : <p className="note">완료</p>;
  if (t.status === 'failed') return <p className="error">{t.error ?? '실패'}</p>;
  if (t.status === 'cancelled') return <p className="note">멈춤</p>;
  const doing =
    t.status === 'queued'
      ? '대기 중 · 러너가 가져가면 시작해요'
      : t.waitReason === 'approval'
        ? '결재 대기 · 결과 카드에서 정하면 이어서 해요'
        : t.waitReason === 'subtasks'
          ? `팀에게 맡김 · 하위 작업 ${t.openSubtasks}개 기다리는 중`
          : '생각 중…';
  return (
    <p className="note">
      {doing}
      {t.status === 'running' && t.progress ? ` · ${t.progress}` : ''}
    </p>
  );
}
