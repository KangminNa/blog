'use client';

import { type FormEvent, useId, useState } from 'react';
import type { Owner } from '../../_account/types';

/** 서버의 Owner.NAME_MAX */
const NAME_MAX = 40;

// 표시 이름: 칸과 보낼 값만 가진다 (저장은 패널). 저장하면 패널이 새 version으로 폼을 다시 만든다 (key)
export function ProfileForm({
  owner,
  busy,
  problem,
  onSubmit,
}: {
  owner: Owner;
  busy: boolean;
  problem: string | null;
  onSubmit: (displayName: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(owner.displayName ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(name.trim());
  }

  return (
    <form className="panel" onSubmit={submit} aria-label="표시 이름">
      <div className="field">
        <label htmlFor={`${id}-name`}>표시 이름</label>
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          maxLength={NAME_MAX}
          placeholder={owner.login}
          aria-describedby={`${id}-help`}
          onChange={(e) => setName(e.target.value)}
        />
        <small id={`${id}-help`}>
          조직도 맨 위 · 결재 도장 · 메뉴 아래에 보이는 이름. 비우면 아이디({owner.login})
        </small>
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button
          type="submit"
          className="cta small"
          disabled={busy || name.trim() === (owner.displayName ?? '')}
        >
          저장
        </button>
      </div>
    </form>
  );
}
