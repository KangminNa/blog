'use client';

import { useRef, useState } from 'react';
import { useDevices } from '../../_account/live';
import { api, describe } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';
import { readPages } from '../../_task/live';
import type { SessionDetail, SessionPage, SessionRevision } from '../../_vault/types';
import { TidyPanel } from './TidyPanel';

/** 세션이 저장되거나 대표 위키가 정해지면 다시 읽는다 */
const SESSION_TOPICS = ['vault.session.*'];
const KIND_LABELS: Record<string, string> = { origin: '원본', human: '사람', merge: '합침' };
/** 판 번호는 최근 몇 개만 펼쳐 둔다 (판이 많으면 노트가 밀려 내려가므로) */
const RECENT_REVISIONS = 8;

function when(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
    : '';
}

function mergePages(before: SessionPage, more: SessionPage): SessionPage {
  return { ...more, sessions: [...before.sessions, ...more.sessions] };
}

// 세션: AI 도구가 저장한 세션 목록(최근 저장 순, 프로젝트로 거르기) → 세션 하나(지금 판의 칸, 판 기록, 지난 판).
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
      <SessionView
        id={openId}
        deviceName={(id) => devices[id] ?? '끊긴 기기'}
        onBack={() => setOpenId(null)}
      />
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TidyPanel />
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
            기기 메뉴에서 AI 도구를 연결하고, 작업을 마칠 때 저장을 요청하면 여기에 표시돼요
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
                    `${s.revisionCount}판`,
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

/** 세션 하나: 지금 판의 칸과 판 기록. 판 번호를 누르면 그 판을 본다 */
function SessionView({
  id,
  deviceName,
  onBack,
}: {
  id: string;
  deviceName: (id: string) => string;
  onBack: () => void;
}) {
  const session = useLiveValue(
    `session:${id}`,
    () => api<SessionDetail>('GET', `/api/sessions/${id}`),
    SESSION_TOPICS,
  );
  /** 골라서 읽은 지난 판. 없으면 지금 판을 보여 준다 */
  const [past, setPast] = useState<SessionRevision | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [allRevisions, setAllRevisions] = useState(false);
  const detail = session.data;
  const shown = past ?? detail?.head ?? null;
  const error = failed ?? session.error;

  // 지난 판은 누를 때 읽는다
  async function pick(seq: number) {
    if (!detail) return;
    if (seq === detail.head.seq) return setPast(null);
    const reply = await api<SessionRevision>('GET', `/api/sessions/${id}/revisions/${seq}`);
    if (!reply.ok) return setFailed(describe(reply.error));
    setPast(reply.data);
  }

  const headings = Object.fromEntries(
    (shown?.sections ?? []).map((s) => [s.name, s.heading] as const),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        ← 목록
      </button>
      {error && <p className="error">{error}</p>}
      {detail && shown ? (
        <>
          <div>
            <h3 className="note-title">{shown.title}</h3>
            <p className="label-mono" style={{ margin: '4px 0 0' }}>
              {[
                detail.project ?? '프로젝트 없음',
                deviceName(detail.deviceId),
                detail.tool,
                detail.visibility === 'public' ? '공개' : '비공개',
              ].join(' · ')}
            </p>
            {shown.tags.length > 0 && (
              <p className="label-mono" style={{ margin: '4px 0 0' }}>
                {shown.tags.map((t) => `#${t}`).join(' ')}
              </p>
            )}
          </div>
          <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="sr">판</legend>
            {(allRevisions ? detail.history : detail.history.slice(0, RECENT_REVISIONS)).map(
              (h) => (
                <button
                  key={h.seq}
                  type="button"
                  className="chip"
                  aria-pressed={shown.seq === h.seq}
                  title={`${KIND_LABELS[h.kind] ?? h.kind} · ${when(h.createdAt)}`}
                  onClick={() => pick(h.seq)}
                >
                  {h.seq}판{h.seq === detail.head.seq ? ' (지금)' : ''}
                </button>
              ),
            )}
            {!allRevisions && detail.history.length > RECENT_REVISIONS && (
              <button type="button" className="chip" onClick={() => setAllRevisions(true)}>
                지난 판 {detail.history.length - RECENT_REVISIONS}개 더
              </button>
            )}
          </fieldset>
          <p className="label-mono" style={{ margin: 0 }}>
            {shown.seq}판 · {KIND_LABELS[shown.kind] ?? shown.kind} · {when(shown.createdAt)}
          </p>
          {shown.warnings.length > 0 && (
            <div className="result">
              <b>저장 전에 지운 비밀값</b>
              <ul>
                {shown.warnings.map((w, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 같은 칸·종류가 여러 번 나올 수 있다
                  <li key={i}>
                    {headings[w.section] ?? '제목'} · {w.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {shown.sections
            .filter((s) => s.text)
            .map((s) => (
              <section
                key={s.name}
                className={s.name === 'quotes' ? 'note-section quote' : 'note-section'}
              >
                <h4>{s.heading}</h4>
                <p>{s.text}</p>
              </section>
            ))}
        </>
      ) : (
        !error && <p className="label-mono">불러오는 중…</p>
      )}
    </div>
  );
}
