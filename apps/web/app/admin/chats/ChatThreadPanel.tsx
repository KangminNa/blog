'use client';

import { useEffect, useRef, useState } from 'react';
import { useMe } from '../../_account/live';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { CHAT_DETAIL_TOPICS } from '../../_task/live';
import type { Chat, ChatDetail } from '../../_task/types';
import { ChatCardForm } from './ChatCardForm';
import { ChatForm } from './ChatForm';
import { ChatQuestion } from './ChatQuestion';
import { ChatTurns } from './ChatTurns';

/** 도는 상태 (멈추기가 보인다) */
const RUNNING = ['routing', 'working'];

// 대화 하나 (2차 1-5, ChatGPT · Claude 같은 모양): 가운데 주고받음, 아래 입력 칸 하나. 팀 · 진행 옆 칸은 없다.
// 맡기 전에는 질문의 고를 것(ChatQuestion)이 아래에 붙고, 결재는 결과 카드 하나로 정한다 (2차 2단계).
// 일하는 중에도 보낸다: 덧붙인 말이 되고 맡은 에이전트가 짧게 답한다 (2차 1-1). 신호가 오면 다시 읽는다
export function ChatThreadPanel({ id }: { id: string }) {
  // 대상(id)으로 거르지 않는다: 신호의 대상은 회차 작업 · 결재라 대화 id가 아니다
  const detail = useLiveValue(
    `chat:${id}`,
    () => api<ChatDetail>('GET', `/api/chats/${id}`),
    CHAT_DETAIL_TOPICS,
  );
  const me = useMe();
  const sending = useAction();
  const cancelling = useAction();
  const deciding = useAction();
  const stopping = useAction();
  /** 응답을 못 받아 다시 보내도 메시지가 한 번만 가게 (보낸 뒤에만 바꾼다) */
  const requestId = useRef('');
  if (!requestId.current) requestId.current = crypto.randomUUID();
  /** 보낸 횟수: 보내면 폼을 새로 만들어 칸을 비운다 (소식이 와도 쓰던 글은 그대로) */
  const [sent, setSent] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const d = detail.data;

  // 새 회차 · 답 · 질문 · 카드가 오면 맨 아래로
  // biome-ignore lint/correctness/useExhaustiveDependencies: 주고받음의 길이와 상태가 바뀔 때만
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [d?.turns.length, d?.turns.at(-1)?.status, d?.news.length, d?.state, d?.card?.id]);

  if (!d)
    return detail.status === 404 ? (
      <p className="rows-empty">찾을 수 없는 대화</p>
    ) : detail.error ? (
      <p className="error">{detail.error}</p>
    ) : (
      <p className="label-mono">불러오는 중…</p>
    );

  const { partner, question } = d;
  const blocked = !partner
    ? null
    : partner.deleted
      ? '삭제한 에이전트라 보낼 수 없어요 (복원하면 이어서)'
      : !partner.topLevel
        ? '팀원이 된 에이전트예요. 관리자 바로 아래 에이전트와만 대화해요'
        : partner.paused
          ? '멈춘 에이전트예요. 재개하면 보낼 수 있어요'
          : null;
  const hint = question
    ? null
    : d.state === 'routing'
      ? '맡길 곳 찾는 중. 보내면 함께 봐요'
      : d.state === 'working'
        ? '일하는 중. 보내면 덧붙인 말이 되고 짧게 답해요 (회차마다 5개)'
        : null;

  async function send(body: { message: string; choice?: string }) {
    const reply = await sending.run(
      'send',
      () =>
        api<Chat>('POST', `/api/chats/${id}/messages`, {
          requestId: requestId.current,
          version: d?.chat.version,
          ...body,
        }),
      { reload: detail.reload, conflict: '그사이 바뀐 대화예요. 최신 내용을 다시 읽었어요' },
    );
    if (!reply?.ok) return;
    requestId.current = crypto.randomUUID();
    setSent((n) => n + 1);
  }

  const decide = (body: { decision: string; note?: string; picked?: string[] }) =>
    d.card &&
    deciding.run(
      'decide',
      () =>
        api('POST', `/api/approvals/${d.card?.id}/decide`, { version: d.card?.version, ...body }),
      {
        done: body.decision === 'approve' ? '고른 것만 남겼어요' : '정했어요',
        reload: detail.reload,
        conflict: '그사이 카드에 항목이 더해졌어요. 다시 골라요',
      },
    );

  const stop = () =>
    stopping.run('stop', () => api('POST', `/api/chats/${id}/stop`, { version: d.chat.version }), {
      done: '멈췄어요',
      reload: detail.reload,
      conflict: '그사이 바뀐 대화예요. 최신 내용을 다시 읽었어요',
    });

  const cancel = (taskId: string, version: number) =>
    cancelling.run(taskId, () => api('POST', `/api/tasks/${taskId}/cancel`, { version }), {
      done: '답을 멈췄어요',
      reload: detail.reload,
      conflict: '이미 바뀐 작업이에요. 최신 내용을 다시 읽었어요',
    });

  return (
    <div className="chat-page">
      <header className="chat-top">
        <h1 className="clamp-1">{d.chat.title}</h1>
        {d.chat.deviceId && <span className="pill">기기에서</span>}
        {(RUNNING.includes(d.state) || d.card) && (
          <button
            type="button"
            className="ghost small"
            disabled={stopping.busy !== null}
            onClick={stop}
          >
            {stopping.busy ? '멈추는 중' : '멈추기'}
          </button>
        )}
      </header>
      {detail.error && <p className="error">{detail.error}</p>}
      {stopping.problem && <p className="error">{stopping.problem}</p>}
      <ChatTurns
        turns={d.turns}
        news={d.news}
        pending={d.chat.pending}
        me={me.data?.name ?? '관리자'}
        partner={partner?.name ?? null}
        busy={cancelling.busy}
        onCancel={cancel}
      />
      {cancelling.problem && <p className="error">{cancelling.problem}</p>}
      {d.state === 'routing' && d.turns.length === 0 && (
        <p className="chat-event" aria-live="polite">
          맡길 곳 찾는 중…
        </p>
      )}
      {question && (
        <ChatQuestion
          question={question}
          busy={sending.busy !== null}
          onPick={(c) => send({ message: c.name, choice: c.id })}
        />
      )}
      {d.card && (
        <ChatCardForm
          key={`${d.card.id}:${d.card.version}`}
          card={d.card}
          busy={deciding.busy !== null}
          problem={deciding.problem}
          onDecide={decide}
        />
      )}
      <ChatForm
        key={sent}
        busy={sending.busy !== null}
        problem={sending.problem}
        blocked={blocked}
        hint={hint}
        onSubmit={send}
      />
      {/* 입력 칸 아래: 여기로 내리면 입력 칸이 마지막 말풍선을 가리지 않는다 */}
      <div ref={bottom} />
    </div>
  );
}
