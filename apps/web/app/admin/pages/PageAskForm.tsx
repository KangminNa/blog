'use client';

import { type FormEvent, useId, useRef, useState } from 'react';

// 페이지를 만들어 달라 · 고쳐 달라는 입력. 칸만 들고, 보내기는 패널이 한다.
export function PageAskForm({
  label,
  placeholder,
  submit,
  busy,
  problem,
  onSubmit,
  onEdit,
}: {
  label: string;
  placeholder: string;
  /** 단추의 글 */
  submit: string;
  busy: boolean;
  problem: string | null;
  /** 보냈으면 true: 칸을 비운다. requestId는 내용을 고치기 전까지 같다 (다시 눌러도 작업은 하나) */
  onSubmit: (instruction: string, requestId: string) => Promise<boolean>;
  onEdit: () => void;
}) {
  const id = useId();
  const [instruction, setInstruction] = useState('');
  const requestId = useRef<string | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    requestId.current ??= crypto.randomUUID();
    if (!(await onSubmit(instruction.trim(), requestId.current))) return;
    requestId.current = null;
    setInstruction('');
  }

  return (
    <form className="ask" onSubmit={send}>
      <label htmlFor={`${id}-text`}>{label}</label>
      <textarea
        id={`${id}-text`}
        rows={2}
        value={instruction}
        placeholder={placeholder}
        onChange={(e) => {
          requestId.current = null;
          onEdit();
          setInstruction(e.target.value);
        }}
      />
      <div className="ask-row">
        <span className="note">끝나면 바로 페이지에 반영 · 공개 전에는 나만 봄</span>
        <span className="spacer" />
        <button type="submit" className="cta small" disabled={busy || !instruction.trim()}>
          {submit}
        </button>
      </div>
      {problem && <p className="error">{problem}</p>}
    </form>
  );
}
