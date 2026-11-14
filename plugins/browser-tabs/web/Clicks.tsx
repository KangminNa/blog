import { useCallback, useEffect, useState } from 'react';
import type { Click, Props } from './browser-types';

// 결재된 클릭 (2차 3단계): AI가 멈춘 마지막 버튼을 러너가 붙잡고, 결재 뒤 같은 버튼인지 보고 누른다.
// 바뀌어 누르지 않았거나(changed) 눌렸는지 모르면(unknown) 화면에서 직접 하고 여기서 기록한다.
// 승인됐는데 러너가 꺼져 있으면 직접 누르거나 그만둘 수 있다. 결재 자체는 결재 화면에서 한다.

const STATUS: Record<string, string> = {
  held: '결재 대기',
  approved: '누를 차례',
  clicking: '누르는 중',
  clicked: '눌렀음',
  changed: '바뀌어 누르지 않음',
  unknown: '눌렸는지 모름',
  dropped: '닫힘',
  manual: '직접 처리',
};
/** 관리자가 기록할 수 있는 상태 (서버의 ManualClick) */
const OPEN_TO_MANUAL = ['approved', 'changed', 'unknown'];

export function Clicks({ call, notify }: Props) {
  const [clicks, setClicks] = useState<Click[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const reply = await call('GET', 'clicks');
    if (reply.ok) setClicks((reply.data as { clicks: Click[] }).clicks);
    else notify(reply.message);
  }, [call, notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function manual(click: Click, done: boolean) {
    setBusy(click.id);
    const reply = await call('POST', `clicks/${click.id}/manual`, { version: click.version, done });
    setBusy(null);
    notify(reply.ok ? (done ? '직접 눌렀다고 기록했어요' : '그만뒀어요') : reply.message);
    load();
  }

  return (
    <section className="stack" aria-label="결재된 클릭">
      <div className="row">
        <b>결재된 클릭</b>
        <button type="button" className="ghost small fit" onClick={() => load()}>
          새로고침
        </button>
      </div>
      {clicks === null ? (
        <p className="note">불러오는 중</p>
      ) : clicks.length === 0 ? (
        <p className="note">아직 멈춘 버튼 없음</p>
      ) : (
        <ul className="list">
          {clicks.map((c) => (
            <li key={c.id} className="panel">
              <b>
                {c.siteName ?? '지운 사이트'} · {c.role} “{c.name}”
              </b>
              <span className="label-mono">
                {STATUS[c.status] ?? c.status} · {c.pageTitle || c.pageUrl}
              </span>
              {c.reason && <p className="note">{c.reason}</p>}
              <div className="row">
                <a className="ghost small fit" href={`/admin/tasks/${c.taskId}`}>
                  작업
                </a>
                {OPEN_TO_MANUAL.includes(c.status) && (
                  <button
                    type="button"
                    className="ghost small fit"
                    disabled={busy !== null}
                    onClick={() => manual(c, true)}
                  >
                    직접 눌렀어요
                  </button>
                )}
                {c.status === 'approved' && (
                  <button
                    type="button"
                    className="ghost small fit"
                    disabled={busy !== null}
                    onClick={() => manual(c, false)}
                  >
                    그만두기
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
