'use client';

import { type FormEvent, useId, useState } from 'react';
import type { NoticeKindSetting, NoticeSettings } from '../../_platform/types';

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

/** 저장할 때 보내는 본문 (PUT /api/notice-settings) */
export type NoticeSettingsBody = {
  version: number;
  digest: string;
  digestTime: string;
  quietStart: string | null;
  quietEnd: string | null;
  timeZone: string;
  routes: Record<string, string>;
};

// 알림 설정 폼: 칸의 상태와 보낼 본문만 가진다. 저장은 패널이 돌린다 (onSubmit).
// 읽은 설정으로 칸을 채운다: 설정의 판이 바뀌면 패널이 key로 폼을 새로 만든다 (칸을 손으로 다시 채우지 않는다).
export function NoticeForm({
  settings,
  busy,
  onSubmit,
}: {
  settings: NoticeSettings;
  busy: boolean;
  onSubmit: (body: NoticeSettingsBody) => void;
}) {
  const id = useId();
  const [digest, setDigest] = useState(settings.digest);
  const [digestTime, setDigestTime] = useState(settings.digestTime);
  const [quiet, setQuiet] = useState(settings.quietStart !== null);
  const [quietStart, setQuietStart] = useState(settings.quietStart ?? '23:00');
  const [quietEnd, setQuietEnd] = useState(settings.quietEnd ?? '07:00');
  const [timeZone, setTimeZone] = useState(
    settings.version === 0 ? browserZone() : settings.timeZone,
  );
  const [routes, setRoutes] = useState<Record<string, string>>(
    Object.fromEntries(settings.kinds.map((k) => [k.kind, k.route])),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      version: settings.version,
      digest,
      digestTime,
      quietStart: quiet ? quietStart : null,
      quietEnd: quiet ? quietEnd : null,
      timeZone: timeZone.trim(),
      routes,
    });
  }

  return (
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
  );
}
