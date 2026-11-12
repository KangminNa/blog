'use client';

import { useEffect, useState } from 'react';
import { useSpace } from '../../_account/live';
import type { SpaceInfo } from '../../_account/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';

type Props = {
  space: SpaceInfo;
  submitLabel: string;
  onSaved: (space: SpaceInfo) => void;
};

// 사이트 이름·소개·주소. 설치 마법사의 3단계와 콘솔의 사이트 메뉴가 함께 쓴다.
// version을 함께 보내서, 다른 곳에서 먼저 바꿨으면 덮지 않고 알린다.
export function BlogForm(props: Props) {
  return props.space.version > 0 ? <SpaceForm {...props} /> : <UnsavedSpaceForm {...props} />;
}

/** 저장한 적 없는 값(version 0)을 받았으면 서버의 지금 값으로 맞춘다 (낡은 버전으로 저장하지 않게) */
function UnsavedSpaceForm(props: Props) {
  const now = useSpace().data;
  const space = now && now.version > 0 ? now : props.space;
  return <SpaceForm key={space.version} {...props} space={space} />;
}

function SpaceForm({ space, submitLabel, onSaved }: Props) {
  const save = useAction();
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [siteUrl, setSiteUrl] = useState(space.siteUrl ?? '');
  const [version, setVersion] = useState(space.version);

  // 아직 정하지 않았으면 지금 연 주소를 미리 넣는다
  useEffect(() => {
    if (!siteUrl) setSiteUrl(window.location.origin);
  }, [siteUrl]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await save.run(
      'save',
      () => api<SpaceInfo>('PUT', '/api/space', { name, description, siteUrl, version }),
      { conflict: '다른 곳에서 먼저 바뀌었어요. 화면을 새로 고친 뒤 다시 저장해 주세요' },
    );
    if (!reply?.ok) return;
    setVersion(reply.data.version);
    onSaved(reply.data);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label className="field">
        <span>이름</span>
        <input
          className="input"
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 개발 기록"
        />
      </label>
      <label className="field">
        <span>소개</span>
        <textarea
          className="input"
          value={description}
          maxLength={300}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="한두 줄로 (비워도 돼요)"
        />
      </label>
      <label className="field">
        <span>사이트 주소</span>
        <input
          className="input"
          value={siteUrl}
          maxLength={300}
          onChange={(e) => setSiteUrl(e.target.value)}
          placeholder="https://blog.example.com"
        />
        <small>바깥에서 들어오는 https 주소. 이 컴퓨터에서만 쓰면 http://localhost도 가능</small>
      </label>
      {save.problem && <p className="error">{save.problem}</p>}
      <button className="cta" type="submit" disabled={save.busy !== null || !name.trim()}>
        <span>{save.busy ? '저장하는 중' : submitLabel}</span>
        <span className="arr">→</span>
      </button>
    </form>
  );
}
