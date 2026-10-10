'use client';

import { useEffect, useState } from 'react';
import { api, describe } from '../_lib/client-api';
import type { SpaceInfo } from '../_lib/types';

// 블로그 이름·소개·사이트 주소. 설치 마법사의 3단계와 관리 모드의 "블로그" 시트가 함께 쓴다.
// version을 함께 보내서, 다른 곳에서 먼저 바꿨으면 덮지 않고 알린다.
export function BlogForm({
  space,
  submitLabel,
  onSaved,
}: {
  space: SpaceInfo;
  submitLabel: string;
  onSaved: (space: SpaceInfo) => void;
}) {
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [siteUrl, setSiteUrl] = useState(space.siteUrl ?? '');
  const [version, setVersion] = useState(space.version);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 아직 정하지 않았으면 지금 연 주소를 미리 넣는다
  useEffect(() => {
    if (!siteUrl) setSiteUrl(window.location.origin);
  }, [siteUrl]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const reply = await api<SpaceInfo>('PUT', '/api/space', {
      name,
      description,
      siteUrl,
      version,
    });
    setBusy(false);
    if (!reply.ok) {
      setError(
        reply.status === 409
          ? '다른 곳에서 먼저 바뀌었어요. 화면을 새로 고친 뒤 다시 저장해 주세요'
          : describe(reply.error),
      );
      return;
    }
    setVersion(reply.data.version);
    onSaved(reply.data);
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label className="field">
        <span>블로그 이름</span>
        <input
          className="input"
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 작업 기록"
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
        <small>방문자가 들어오는 바깥 주소. 리버스 프록시 뒤라면 https://로 시작하는 주소</small>
      </label>
      {error && <p className="error">{error}</p>}
      <button className="cta" type="submit" disabled={busy || !name.trim()}>
        <span>{busy ? '저장하는 중' : submitLabel}</span>
        <span className="arr">→</span>
      </button>
    </form>
  );
}
