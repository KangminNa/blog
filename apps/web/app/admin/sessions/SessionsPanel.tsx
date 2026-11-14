'use client';

import { useRef, useState } from 'react';
import { useDevices } from '../../_account/live';
import { useLiveValue } from '../../_lib/use-live';
import { readPages } from '../../_task/live';
import type { SessionPage } from '../../_vault/types';
import { ProjectsPanel } from './ProjectsPanel';
import { SESSION_TOPICS, SessionPanel, when } from './SessionPanel';
import { TidyPanel } from './TidyPanel';

function mergePages(before: SessionPage, more: SessionPage): SessionPage {
  return { ...more, sessions: [...before.sessions, ...more.sessions] };
}

// 세션: AI 도구가 저장하거나 수집 훅 · 확장이 올린 세션 목록(최근 순, 프로젝트로 거르기) → 세션 하나 (SessionPanel).
// 위에 자동 정리(TidyPanel)와 프로젝트별 원문 모으기(ProjectsPanel)
export function SessionsPanel({ initialId }: { initialId: string | null }) {
  const [project, setProject] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialId);
  /** 읽어 둔 쪽 수. "더 보기"로 늘고 프로젝트를 바꾸면 첫 쪽부터 */
  const pages = useRef(1);
  const path = project ? `/api/sessions?${new URLSearchParams({ project })}` : '/api/sessions';
  const list = useLiveValue(
    `sessions:${project ?? ''}`,
    () => readPages(path, pages.current, mergePages),
    SESSION_TOPICS,
  );
  const deviceList = useDevices();
  const sessions = list.data?.sessions ?? null;
  const devices: Record<string, string> = Object.fromEntries(
    (deviceList.data?.devices ?? []).map((d) => [d.id, d.name]),
  );
  // 거른 목록에는 그 프로젝트만 있으므로, 지금까지 본 프로젝트를 기억해 둔다
  const [projects, setProjects] = useState<readonly string[]>([]);
  const seen = (sessions ?? []).flatMap((s) => (s.project ? [s.project] : []));
  if (seen.some((p) => !projects.includes(p))) setProjects([...new Set([...projects, ...seen])]);

  function filter(to: string | null) {
    pages.current = 1;
    setProject(to);
  }

  if (openId)
    return (
      <SessionPanel
        id={openId}
        deviceName={(id) => devices[id] ?? '끊긴 기기'}
        onBack={() => setOpenId(null)}
      />
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TidyPanel />
      <ProjectsPanel />
      {projects.length > 1 && (
        <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sr">프로젝트</legend>
          <button
            type="button"
            className="chip"
            aria-pressed={project === null}
            onClick={() => filter(null)}
          >
            전체
          </button>
          {projects.map((p) => (
            <button
              key={p}
              type="button"
              className="chip"
              aria-pressed={project === p}
              onClick={() => filter(project === p ? null : p)}
            >
              {p}
            </button>
          ))}
        </fieldset>
      )}
      {list.error && <p className="error">{list.error}</p>}
      {sessions === null ? (
        <p className="label-mono">불러오는 중…</p>
      ) : sessions.length === 0 ? (
        <div className="result">
          <b>저장한 세션 없음</b>
          <p className="label-mono" style={{ margin: '6px 0 0' }}>
            cairn connect로 연결하면 Claude Code 세션이 끝날 때 저절로 올라와요
          </p>
        </div>
      ) : (
        <ul className="list">
          {sessions.map((s) => (
            <li key={s.id}>
              <button type="button" className="list-row" onClick={() => setOpenId(s.id)}>
                <b>{s.title || '제목 없음'}</b>
                <small>
                  {[
                    s.project ?? '프로젝트 없음',
                    devices[s.deviceId] ?? s.tool,
                    s.revisionCount > 0 ? `버전 ${s.revisionCount}` : '노트 쓰는 중',
                    when(s.lastRevisionAt),
                  ].join(' · ')}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.data?.next && (
        <button
          type="button"
          className="ghost wide"
          onClick={() => {
            pages.current += 1;
            void list.reload();
          }}
        >
          더 보기
        </button>
      )}
    </div>
  );
}
