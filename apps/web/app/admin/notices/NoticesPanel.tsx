'use client';

import { type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { api, describe } from '../../_lib/client-api';
import type { NoticeKindSetting, NoticeSettings } from '../../_platform/types';
import { useNotify } from '../AdminShell';

const SEVERITY_LABELS: Record<string, string> = {
  immediate: '즉시',
  digest: '묶음',
  log: '기록만',
};
const ROUTE_LABELS: Record<string, string> = {
  push: '푸시까지',
  center: '알림 센터만',
  off: '끄기',
};

/** 이 브라우저의 시간대 (처음 정할 때의 기본값) */
function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// 알림 설정 (7단계). 무엇을 알리는지는 모듈이 정하고(종류 목록), 여기서는 어디로 · 언제 보낼지를 정한다.
//   즉시: 바로 푸시 · 묶음: 한 시간이나 하루에 한 번 모아서 · 기록만: 알림 센터에만
//   조용한 시간에는 푸시를 미뤘다가 끝날 때 모아 보낸다 (알림 센터에는 바로 쌓인다)
export function NoticesPanel() {
  const id = useId();
  const notify = useNotify();
  const [settings, setSettings] = useState<NoticeSettings | null>(null);
  const [digest, setDigest] = useState('hourly');
  const [digestTime, setDigestTime] = useState('09:00');
  const [quiet, setQuiet] = useState(false);
  const [quietStart, setQuietStart] = useState('23:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const [timeZone, setTimeZone] = useState('UTC');
  const [routes, setRoutes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const reply = await api<NoticeSettings>('GET', '/api/notice-settings');
    if (!reply.ok) return setProblem(describe(reply.error));
    const s = reply.data;
    setSettings(s);
    setDigest(s.digest);
    setDigestTime(s.digestTime);
    setQuiet(s.quietStart !== null);
    setQuietStart(s.quietStart ?? '23:00');
    setQuietEnd(s.quietEnd ?? '07:00');
    setTimeZone(s.version === 0 ? browserZone() : s.timeZone);
    setRoutes(Object.fromEntries(s.kinds.map((k) => [k.kind, k.route])));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!settings || busy) return;
    setBusy(true);
    setProblem(null);
    const reply = await api<NoticeSettings>('PUT', '/api/notice-settings', {
      version: settings.version,
      digest,
      digestTime,
      quietStart: quiet ? quietStart : null,
      quietEnd: quiet ? quietEnd : null,
      timeZone: timeZone.trim(),
      routes,
    });
    setBusy(false);
    if (!reply.ok) {
      if (reply.status === 409) {
        await load();
        return setProblem('이미 바뀐 설정이에요. 최신 내용을 다시 읽었어요');
      }
      return setProblem(describe(reply.error));
    }
    setSettings(reply.data);
    notify('알림 설정을 저장했어요');
  }

  return (
    <>
      <header className="page-head">
        <h1>알림</h1>
      </header>
      <p className="note">
        결재 요청 · 작업 실패 같은 일을 알려요. 즉시 알림은 바로, 묶음은 모아서 보내고, 기록만은
        알림 센터(머리줄의 알림)에만 남아요
      </p>
      {problem && <p className="error">{problem}</p>}
      {settings === null ? (
        !problem && <p className="label-mono">불러오는 중…</p>
      ) : (
        <form className="panel stack" onSubmit={submit} aria-label="알림 설정">
          <div className="field">
            <label htmlFor={`${id}-digest`}>묶음 보내기</label>
            <select
              id={`${id}-digest`}
              className="input"
              value={digest}
              onChange={(e) => setDigest(e.target.value)}
            >
              <option value="hourly">한 시간마다</option>
              <option value="daily">하루 한 번</option>
            </select>
          </div>
          {digest === 'daily' && (
            <div className="field">
              <label htmlFor={`${id}-digest-at`}>묶음을 보낼 시각</label>
              <input
                id={`${id}-digest-at`}
                className="input"
                type="time"
                value={digestTime}
                required
                onChange={(e) => setDigestTime(e.target.value)}
              />
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={quiet} onChange={() => setQuiet(!quiet)} />
            조용한 시간
          </label>
          {quiet && (
            <div className="row">
              <label htmlFor={`${id}-quiet-start`}>시작</label>
              <input
                id={`${id}-quiet-start`}
                className="input"
                type="time"
                value={quietStart}
                required
                onChange={(e) => setQuietStart(e.target.value)}
              />
              <label htmlFor={`${id}-quiet-end`}>끝</label>
              <input
                id={`${id}-quiet-end`}
                className="input"
                type="time"
                value={quietEnd}
                required
                onChange={(e) => setQuietEnd(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor={`${id}-zone`}>시간대</label>
            <input
              id={`${id}-zone`}
              className="input"
              value={timeZone}
              required
              maxLength={100}
              onChange={(e) => setTimeZone(e.target.value)}
            />
            <small>IANA 이름 (예: Asia/Seoul). 묶음 시각과 조용한 시간의 기준</small>
          </div>
          <ul className="list" aria-label="알림 종류">
            {settings.kinds.map((k: NoticeKindSetting) => (
              <li key={k.kind} className="list-cell schedule-row">
                <div className="item-main">
                  <b>{k.label}</b>
                  <small>{SEVERITY_LABELS[k.severity] ?? k.severity}</small>
                </div>
                <select
                  className="input"
                  aria-label={`${k.label} 경로`}
                  value={routes[k.kind] ?? k.route}
                  onChange={(e) => setRoutes({ ...routes, [k.kind]: e.target.value })}
                >
                  {Object.entries(ROUTE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="submit" className="cta small" disabled={busy}>
              저장
            </button>
          </div>
        </form>
      )}
    </>
  );
}
