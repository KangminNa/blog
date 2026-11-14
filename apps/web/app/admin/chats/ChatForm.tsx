'use client';

import { type FormEvent, type KeyboardEvent, useState } from 'react';

/** 메시지 한 개의 길이 (서버 Chat.MESSAGE_MAX) */
const MESSAGE_MAX = 8000;

// 대화 안의 메시지 입력 칸. Enter로 보내고 Shift+Enter로 줄을 바꾼다 (한글 조합 중의 Enter는 보내지 않는다).
// 일하는 중에도 보낸다: 그 회차에 덧붙인 말이 된다 (2차 1-1). 보낸 뒤 칸을 비우는 것은 패널이 key로 폼을 새로 만들어서.
// 새 대화(ChatNewPanel)와 대화 하나(ChatThreadPanel)가 함께 쓴다 (2차 1-5: 입력은 하나)
export function ChatForm({
  busy,
  problem,
  blocked,
  hint,
  rows = 2,
  onSubmit,
}: {
  busy: boolean;
  problem: string | null;
  /** 보낼 수 없는 까닭 (상대가 바뀜 등). 있으면 칸을 잠근다 */
  blocked: string | null;
  /** 보내면 어떻게 되는지 (일하는 중이면 덧붙인 말) */
  hint: string | null;
  /** 입력 칸의 처음 줄 수 (새 대화는 크게) */
  rows?: number;
  onSubmit: (body: { message: string }) => void;
}) {
  const [message, setMessage] = useState('');
  const locked = busy || blocked !== null;

  function send(e?: FormEvent) {
    e?.preventDefault();
    const text = message.trim();
    if (!text || locked) return;
    onSubmit({ message: text });
  }

  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  }

  return (
    <form className="chat-compose" onSubmit={send}>
      {blocked ? <p className="note">{blocked}</p> : hint && <p className="note">{hint}</p>}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="chat-compose-row">
        <textarea
          className="input"
          aria-label="메시지"
          placeholder="메시지 (Enter로 보내기, Shift+Enter로 줄 바꿈)"
          rows={rows}
          maxLength={MESSAGE_MAX}
          value={message}
          disabled={blocked !== null}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={keys}
        />
        <button type="submit" className="cta small" disabled={locked || !message.trim()}>
          {busy ? '보내는 중' : '보내기'}
        </button>
      </div>
    </form>
  );
}
