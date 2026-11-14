'use client';

import { useState } from 'react';
import { api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import type { BrowserShot, BrowserShots as Shots } from './types';

// 브라우저 작업의 화면 (browser-tabs 패키지, 2차 3단계 단계 캡처): AI가 단계마다 찍은 화면과 러너가 찍은 로그인 · 멈춘 · 누른 뒤 화면.
// 목록은 그림 없이 받고, 고른 것만 그림을 받는다. 패키지가 꺼져 있으면 아무것도 그리지 않는다.

const KINDS: Record<string, string> = {
  step: '단계',
  login: '로그인 화면',
  before: '멈춘 화면',
  after: '누른 뒤',
  changed: '바뀐 화면',
};
const NO_SHOT = { ok: true, data: null } as const;

export function BrowserShots({ taskId }: { taskId: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const list = useLiveValue(
    `browser-shots:${taskId}`,
    () => api<Shots>('GET', `/api/p/browser-tabs/shots?taskId=${taskId}`),
    ['task.task.changed', 'task.event.added'],
    taskId,
  );
  const shot = useLiveValue<BrowserShot | null>(
    `browser-shot:${picked ?? 'none'}`,
    () =>
      picked
        ? api<BrowserShot>('GET', `/api/p/browser-tabs/shots/${picked}`)
        : Promise.resolve(NO_SHOT),
    [],
  );
  const shots = list.data?.shots ?? [];
  if (shots.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="task-browser-shots">
      <h2 id="task-browser-shots">브라우저 화면</h2>
      <div className="row">
        {shots.map((s) => (
          <button
            key={s.id}
            type="button"
            className={picked === s.id ? 'cta small' : 'ghost small'}
            onClick={() => setPicked(picked === s.id ? null : s.id)}
          >
            {s.seq}. {KINDS[s.kind] ?? s.kind}
          </button>
        ))}
      </div>
      {shot.error && <p className="error">{shot.error}</p>}
      {shot.data && (
        <>
          {shot.data.url && <p className="label-mono">{shot.data.url}</p>}
          {/* biome-ignore lint/performance/noImgElement: 관리자만 보는 화면 그림(base64)이라 Next의 이미지 최적화를 거치지 않는다 */}
          <img
            src={`data:${shot.data.mime};base64,${shot.data.image}`}
            alt={KINDS[shot.data.kind] ?? shot.data.kind}
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
        </>
      )}
    </section>
  );
}
