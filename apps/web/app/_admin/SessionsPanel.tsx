'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, describe } from '../_lib/client-api';
import type {
  Device,
  SessionDetail,
  SessionPage,
  SessionRevision,
  SessionSummary,
} from '../_lib/types';

const KIND_LABELS: Record<string, string> = { origin: '원본', human: '사람', merge: '합침' };
/** 판 번호는 최근 몇 개만 펼쳐 둔다 (판이 많으면 노트가 밀려 내려가므로) */
const RECENT_REVISIONS = 8;

function when(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
    : '';
}

// 세션 시트: AI 도구가 저장한 세션 목록(최근 저장 순, 프로젝트로 거르기) → 세션 하나(지금 판의 칸, 판 기록, 지난 판).
// AI 도구의 save_session 응답 링크(?sheet=sessions&session=<id>)로 들어오면 그 세션을 바로 연다.
export function SessionsPanel({ initialId }: { initialId: string | null }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [devices, setDevices] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(initialId);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (filter: string | null, cursor: string | null) => {
    const query = new URLSearchParams();
    if (filter) query.set('project', filter);
    if (cursor) query.set('cursor', cursor);
    const reply = await api<SessionPage>('GET', `/api/sessions?${query}`);
    if (!reply.ok) return setError(describe(reply.error));
    setError(null);
    setSessions((before) =>
      cursor ? [...(before ?? []), ...reply.data.sessions] : reply.data.sessions,
    );
    setNext(reply.data.next);
    if (!filter)
      setProjects((known) => [
        ...new Set([
          ...known,
          ...reply.data.sessions.flatMap((s) => (s.project ? [s.project] : [])),
        ]),
      ]);
  }, []);

  useEffect(() => {
    void load(project, null);
  }, [load, project]);

  useEffect(() => {
    void api<{ devices: Device[] }>('GET', '/api/devices').then((reply) => {
      if (reply.ok) setDevices(Object.fromEntries(reply.data.devices.map((d) => [d.id, d.name])));
    });
  }, []);

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
      {projects.length > 1 && (
        <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sr">프로젝트</legend>
          <button
            type="button"
            className="chip"
            aria-pressed={project === null}
            onClick={() => setProject(null)}
          >
            전체
          </button>
          {projects.map((p) => (
            <button
              key={p}
              type="button"
              className="chip"
              aria-pressed={project === p}
              onClick={() => setProject(project === p ? null : p)}
            >
              {p}
            </button>
          ))}
        </fieldset>
      )}
      {error && <p className="error">{error}</p>}
      {sessions === null ? (
        <p className="label-mono">불러오는 중…</p>
      ) : sessions.length === 0 ? (
        <div className="result">
          <b>아직 저장한 세션 없음</b>
          <p className="label-mono" style={{ margin: '6px 0 0' }}>
            기기 시트에서 AI 도구를 연결하고, 작업을 마칠 때 저장을 부탁하면 여기에 쌓여요
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
      {next && (
        <button type="button" className="ghost wide" onClick={() => load(project, next)}>
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
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [shown, setShown] = useState<SessionRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allRevisions, setAllRevisions] = useState(false);

  useEffect(() => {
    void api<SessionDetail>('GET', `/api/sessions/${id}`).then((reply) => {
      if (!reply.ok) return setError(describe(reply.error));
      setDetail(reply.data);
      setShown(reply.data.head);
    });
  }, [id]);

  async function pick(seq: number) {
    if (!detail) return;
    if (seq === detail.head.seq) return setShown(detail.head);
    const reply = await api<SessionRevision>('GET', `/api/sessions/${id}/revisions/${seq}`);
    if (!reply.ok) return setError(describe(reply.error));
    setShown(reply.data);
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
