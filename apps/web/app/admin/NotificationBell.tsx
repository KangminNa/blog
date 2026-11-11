'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import type { Notification, NotificationList } from '../_platform/types';

/** 알림이 남거나 읽히면 오는 변경 신호 */
const TOPICS = ['platform.notification'];

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

// 콘솔 머리줄의 알림: 안 읽은 수와 최근 알림. 누르면 그 주소로 가고 읽음이 된다.
// 무엇을 알리는지는 알리는 쪽(예: 지울 만한 위키)이 정한다. 푸시 · 이메일은 7단계.
export function NotificationBell() {
  const router = useRouter();
  const list = useLiveValue(
    'notifications',
    () => api<NotificationList>('GET', '/api/notifications'),
    TOPICS,
  );
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const unread = list.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('mousedown', close);
    };
  }, [open]);

  async function go(notice: Notification) {
    if (!notice.read) await api('POST', '/api/notifications/read', { ids: [notice.id] });
    setOpen(false);
    await list.reload();
    if (notice.link) router.push(notice.link);
  }

  async function readAll() {
    await api('POST', '/api/notifications/read', {});
    await list.reload();
  }

  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="ghost bell-button"
        aria-expanded={open}
        aria-label={unread > 0 ? `알림, 안 읽음 ${unread}개` : '알림'}
        onClick={() => setOpen(!open)}
      >
        알림
        {unread > 0 && <span className="pill on">{unread}</span>}
      </button>
      {open && (
        <section className="bell-panel" aria-label="알림 목록">
          <div className="row bell-head">
            <b>알림</b>
            {unread > 0 && (
              <button type="button" className="ghost" onClick={readAll}>
                모두 읽음
              </button>
            )}
          </div>
          {list.error && <p className="error">{list.error}</p>}
          {list.data && list.data.notifications.length === 0 ? (
            <p className="rows-empty">알림 없음</p>
          ) : (
            <ul className="list">
              {list.data?.notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={n.read ? 'item bell-item' : 'item bell-item unread'}
                    onClick={() => go(n)}
                  >
                    <div className="item-main">
                      <b>{n.title}</b>
                      {n.body && <small>{n.body}</small>}
                      <small>{when(n.createdAt)}</small>
                    </div>
                    {!n.read && (
                      <>
                        <span className="dot" aria-hidden="true" />
                        <span className="sr">안 읽음</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
