'use client';

import { useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import type { SessionDetail, SessionRevision, Transcript } from '../../_vault/types';

/** 세션이 저장되거나 노트 · 대표 위키가 정해지면 다시 읽는다 */
export const SESSION_TOPICS = ['vault.session.*'];
const KIND_LABELS: Record<string, string> = { origin: '원본', human: '사람', merge: '합침' };
const ACTOR_LABELS: Record<string, string> = { ai: '서버 러너', device: '기기', user: '관리자' };
/** 판 번호는 최근 몇 개만 펼쳐 둔다 (판이 많으면 노트가 밀려 내려가므로) */
const RECENT_REVISIONS = 8;

export function when(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
    : '';
}

// 세션 하나: 지금 판의 칸과 판 기록 (판 번호를 누르면 그 판), 원문 (수집 훅 · 확장이 올린 것, 2차 4단계).
// 원문만 있고 노트가 아직 없으면 "노트 쓰는 중" (서버 러너가 쓴다)
export function SessionPanel({
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
  const action = useAction();
  /** 골라서 읽은 지난 판. 없으면 지금 판을 보여 준다 */
  const [past, setPast] = useState<SessionRevision | null>(null);
  const [allRevisions, setAllRevisions] = useState(false);
  const detail = session.data;
  const shown = past ?? detail?.head ?? null;
  const error = action.problem ?? session.error;

  // 지난 판은 누를 때 읽는다
  async function pick(seq: number) {
    if (!detail) return;
    if (seq === detail.head?.seq) return setPast(null);
    const reply = await action.run(`revision:${seq}`, () =>
      api<SessionRevision>('GET', `/api/sessions/${id}/revisions/${seq}`),
    );
    if (reply?.ok) setPast(reply.data);
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
      {detail ? (
        <>
          <div>
            <h3 className="note-title">{shown?.title ?? (detail.title || '제목 없음')}</h3>
            <p className="label-mono" style={{ margin: '4px 0 0' }}>
              {[
                detail.project ?? '프로젝트 없음',
                deviceName(detail.deviceId),
                detail.tool,
                detail.visibility === 'public' ? '공개' : '비공개',
              ].join(' · ')}
            </p>
            {shown && shown.tags.length > 0 && (
              <p className="label-mono" style={{ margin: '4px 0 0' }}>
                {shown.tags.map((t) => `#${t}`).join(' ')}
              </p>
            )}
          </div>
          {shown === null && <p className="note">노트 쓰는 중 · 서버 러너가 원문으로 써요</p>}
          {detail.history.length > 0 && (
            <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="sr">버전</legend>
              {(allRevisions ? detail.history : detail.history.slice(0, RECENT_REVISIONS)).map(
                (h) => (
                  <button
                    key={h.seq}
                    type="button"
                    className="chip"
                    aria-pressed={shown?.seq === h.seq}
                    title={`${KIND_LABELS[h.kind] ?? h.kind} · ${ACTOR_LABELS[h.actorType] ?? h.actorType} · ${when(h.createdAt)}`}
                    onClick={() => pick(h.seq)}
                  >
                    버전 {h.seq}
                    {h.seq === detail.head?.seq ? ' (지금)' : ''}
                  </button>
                ),
              )}
              {!allRevisions && detail.history.length > RECENT_REVISIONS && (
                <button type="button" className="chip" onClick={() => setAllRevisions(true)}>
                  지난 버전 {detail.history.length - RECENT_REVISIONS}개 더
                </button>
              )}
            </fieldset>
          )}
          {shown && (
            <>
              <p className="label-mono" style={{ margin: 0 }}>
                버전 {shown.seq} · {KIND_LABELS[shown.kind] ?? shown.kind} · {when(shown.createdAt)}
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
          )}
          {detail.transcripts.length > 0 && (
            <Transcripts sessionId={id} items={detail.transcripts} />
          )}
        </>
      ) : (
        !error && <p className="label-mono">불러오는 중…</p>
      )}
    </div>
  );
}

/** 원문: 번호를 누르면 그 원문을 펼친다 (지운 비밀값은 [지움: 종류]로 남아 있다) */
function Transcripts({
  sessionId,
  items,
}: {
  sessionId: string;
  items: SessionDetail['transcripts'];
}) {
  const action = useAction();
  const [open, setOpen] = useState<Transcript | null>(null);

  async function show(seq: number) {
    if (open?.seq === seq) return setOpen(null);
    const reply = await action.run(`transcript:${seq}`, () =>
      api<Transcript>('GET', `/api/sessions/${sessionId}/transcripts/${seq}`),
    );
    if (reply?.ok) setOpen(reply.data);
  }

  return (
    <section className="note-section" aria-label="원문">
      <h4>원문</h4>
      <fieldset className="row" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="sr">원문 번호</legend>
        {items.map((t) => (
          <button
            key={t.seq}
            type="button"
            className="chip"
            aria-pressed={open?.seq === t.seq}
            disabled={action.busy !== null}
            title={when(t.createdAt)}
            onClick={() => show(t.seq)}
          >
            원문 {t.seq} · {t.chars.toLocaleString('ko-KR')}자
            {t.redactions > 0 ? ` · 지움 ${t.redactions}` : ''}
          </button>
        ))}
      </fieldset>
      {action.problem && <p className="error">{action.problem}</p>}
      {open && <pre className="transcript">{open.text}</pre>}
    </section>
  );
}
