'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { countOf, useAgents, useTasksIn } from '../../_task/live';
import type { TidyBacklog, TidySettings } from '../../_vault/types';

const NO_TOPICS: readonly string[] = [];

// 세션 정리: 자동 정리 켜고 끄기, 쌓인 세션 정리 요청. 맡을 에이전트가 없으면 일이 대기열에 남으므로 여기서 알린다.
export function TidyPanel() {
  const settings = useLiveValue(
    'tidy:settings',
    () => api<TidySettings>('GET', '/api/tidy/settings'),
    NO_TOPICS,
  );
  const agents = useAgents();
  const queued = useTasksIn('queued');
  const action = useAction();
  const [result, setResult] = useState<string | null>(null);
  const problem = action.problem ?? settings.error;

  const on = settings.data?.autoTidy ?? false;
  const tasks = queued.data?.tasks.filter((t) => t.kind === 'tidy_session');
  const able = agents.data?.agents.some((a) => a.status === 'active' && a.scopes.includes('tidy'));
  const stuck = able === false && (on || (tasks?.length ?? 0) > 0);

  function toggle() {
    const seen = settings.data;
    if (!seen) return;
    void action.run(
      'toggle',
      () => api('PUT', '/api/tidy/settings', { autoTidy: !on, version: seen.version }),
      { reload: settings.reload },
    );
  }

  async function backlog() {
    setResult(null);
    const reply = await action.run('backlog', () => api<TidyBacklog>('POST', '/api/tidy/backlog'));
    if (!reply?.ok) return;
    const { requested, remaining } = reply.data;
    setResult(requested === 0 ? '정리할 세션 없음' : `${requested}건 요청 · ${remaining}건 남음`);
  }

  return (
    <section className="plugin" aria-label="세션 정리">
      <div className="plugin-head">
        <div>
          <b>자동 정리</b>
          <p>저장할 때마다 구독 토큰 사용</p>
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={on}
          aria-label="자동 정리"
          disabled={action.busy !== null || settings.data === null}
          onClick={toggle}
        />
      </div>
      <div className="row">
        <button type="button" className="ghost" disabled={action.busy !== null} onClick={backlog}>
          쌓인 세션 정리
        </button>
        <span className="note" role="status">
          {result ?? ''}
        </span>
      </div>
      {stuck && (
        <p className="warn">
          tidy 권한이 있는 에이전트 없음 · 대기 {countOf(tasks, queued.data?.next)}건.{' '}
          <Link href="/admin/agents">에이전트</Link>에 tidy와 read_all을 주면 정리가 시작돼요
        </p>
      )}
      {problem && <p className="error">{problem}</p>}
    </section>
  );
}
