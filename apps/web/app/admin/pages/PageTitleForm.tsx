'use client';

import { type FormEvent, useId, useState } from 'react';

// 페이지 제목 고치기. 칸만 들고, 저장은 패널이 한다. 주소(이름)는 바뀌지 않는다.
export function PageTitleForm({
  title,
  busy,
  problem,
  onSubmit,
  onClose,
}: {
  title: string;
  busy: boolean;
  problem: string | null;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(title);

  function send(event: FormEvent) {
    event.preventDefault();
    onSubmit(value.trim());
  }

  return (
    <form className="panel" onSubmit={send}>
      <div className="field">
        <label htmlFor={`${id}-title`}>제목</label>
        <input
          id={`${id}-title`}
          className="input"
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
        />
        <small>주소는 그대로</small>
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button
          type="submit"
          className="cta small"
          disabled={busy || !value.trim() || value.trim() === title}
        >
          저장
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
