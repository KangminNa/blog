'use client';

import { useId, useState } from 'react';
import type { ToolTextDetail } from '../../_mcp/types';

/** 저장할 글: 설명과 기본 글과 다른 칸 설명만 (같은 칸은 보내지 않아 기본 글을 따라간다) */
export type ToolTextSubmit = {
  description: string;
  input: Record<string, string>;
  note: string;
};

const DESCRIPTION_MAX = 4000;
const FIELD_MAX = 1000;

/**
 * 도구 하나의 글 칸: 설명과 입력 칸마다 설명. 처음 값은 지금 쓰는 글이고, 버전이 바뀌면 패널이 key로 새로 만든다.
 * 비운 칸 설명은 기본 글을 쓴다
 */
export function ToolTextForm({
  detail,
  busy,
  onSubmit,
}: {
  detail: ToolTextDetail;
  busy: boolean;
  onSubmit: (text: ToolTextSubmit) => void;
}) {
  const id = useId();
  const [description, setDescription] = useState(detail.description);
  const [input, setInput] = useState<Record<string, string>>({ ...detail.input });
  const [note, setNote] = useState('');
  const changed =
    description !== detail.description ||
    detail.fields.some((f) => (input[f.path] ?? '') !== (detail.input[f.path] ?? ''));

  function submit() {
    const fields = detail.fields
      .map((f) => [f.path, (input[f.path] ?? '').trim()] as const)
      .filter(([path, text]) => text !== '' && text !== detail.default.input[path]);
    onSubmit({ description, input: Object.fromEntries(fields), note });
  }

  function reset() {
    setDescription(detail.description);
    setInput({ ...detail.input });
  }

  return (
    <div className="stack">
      <label className="label-mono" htmlFor={`${id}-description`}>
        설명
      </label>
      <textarea
        id={`${id}-description`}
        className="input"
        rows={6}
        maxLength={DESCRIPTION_MAX}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {detail.fields.map((f) => (
        <div key={f.path} className="stack">
          <label className="label-mono" htmlFor={`${id}-${f.path}`}>
            {f.path} {f.type && `· ${f.type}`}
          </label>
          <textarea
            id={`${id}-${f.path}`}
            className="input"
            rows={2}
            maxLength={FIELD_MAX}
            placeholder={detail.default.input[f.path] ?? ''}
            value={input[f.path] ?? ''}
            onChange={(e) => setInput({ ...input, [f.path]: e.target.value })}
          />
        </div>
      ))}
      <div className="row">
        <label className="sr" htmlFor={`${id}-note`}>
          메모
        </label>
        <input
          id={`${id}-note`}
          className="input"
          placeholder="무엇을 왜 바꿨는지 (선택)"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="button"
          className="cta small"
          disabled={busy || !changed || !description.trim()}
          onClick={submit}
        >
          새 버전으로 저장
        </button>
        {changed && (
          <button type="button" className="ghost" disabled={busy} onClick={reset}>
            변경 취소
          </button>
        )}
      </div>
    </div>
  );
}
