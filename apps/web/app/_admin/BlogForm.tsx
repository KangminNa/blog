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

  // 저장한 적 없는 값(version 0)을 받았으면 서버의 지금 값으로 맞춘다 (낡은 버전으로 저장하지 않게)
  useEffect(() => {
    if (space.version > 0) return;
    void api<SpaceInfo>('GET', '/api/space').then((reply) => {
      if (!reply.ok || reply.data.version < 1) return;
      setVersion(reply.data.version);
      if (reply.data.name) setName(reply.data.name);
      if (reply.data.description) setDescription(reply.data.description);
      if (reply.data.siteUrl) setSiteUrl(reply.data.siteUrl);
    });
  }, [space.version]);

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
        <small>바깥에서 들어오는 https 주소. 이 컴퓨터에서만 쓰면 http://localhost도 가능</small>
      </label>
      {error && <p className="error">{error}</p>}
      <button className="cta" type="submit" disabled={busy || !name.trim()}>
        <span>{busy ? '저장하는 중' : submitLabel}</span>
        <span className="arr">→</span>
      </button>
    </form>
  );
}
