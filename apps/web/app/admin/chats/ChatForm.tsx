'use client';

import { type FormEvent, type KeyboardEvent, useState } from 'react';
import type { Agent } from '../../_task/types';

/** 메시지 한 개의 길이 (서버 Chat.MESSAGE_MAX) */
const MESSAGE_MAX = 8000;

// 메시지 입력 칸. Enter로 보내고 Shift+Enter로 줄을 바꾼다 (한글 조합 중의 Enter는 보내지 않는다).
// partners가 있으면 새 대화: 상대를 고른다. 보낸 뒤 칸을 비우는 것은 패널이 key로 폼을 새로 만들어서.
export function ChatForm({
  partners,
  busy,
  problem,
  blocked,
  onSubmit,
}: {
  partners?: readonly Agent[];
  busy: boolean;
  problem: string | null;
  /** 보낼 수 없는 까닭 (답을 기다리는 중, 상대가 바뀜 등). 있으면 칸을 잠근다 */
  blocked: string | null;
  onSubmit: (body: { message: string; agentId?: string }) => void;
}) {
  const [message, setMessage] = useState('');
  const [agentId, setAgentId] = useState(partners?.[0]?.id ?? '');
  const locked = busy || blocked !== null;

  function send(e?: FormEvent) {
    e?.preventDefault();
    const text = message.trim();
    if (!text || locked) return;
    onSubmit(partners ? { message: text, agentId } : { message: text });
  }

  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  }

  return (
    <form className="chat-compose" onSubmit={send}>
      {partners && (
        <label className="field">
          <span>상대</span>
          <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {partners.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {blocked && <p className="note">{blocked}</p>}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="chat-compose-row">
        <textarea
          className="input"
          aria-label="메시지"
          placeholder={
            partners ? '무엇을 할까요?' : '메시지 (Enter로 보내기, Shift+Enter로 줄 바꿈)'
          }
          rows={2}
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
