import { type FormEvent, useCallback, useEffect, useState } from 'react';

// browser-tabs의 콘솔 화면. 주소를 넣으면 러너가 로그인된 브라우저 탭으로 열어 읽고 남긴다.
// 화면은 react와 이 폴더만 가져온다: 서버 호출(call)과 알림(notify)은 콘솔이 넘겨 준다.

type Reply = { ok: true; data: unknown } | { ok: false; message: string };
type Props = {
  call: (method: string, path: string, body?: object) => Promise<Reply>;
  notify: (text: string) => void;
};
type TabRead = {
  id: string;
  url: string;
  status: string;
  title: string | null;
  preview: string | null;
  error: string | null;
  requestedAt: string;
  readAt: string | null;
};

const STATUS: Record<string, string> = { requested: '기다림', done: '읽음', failed: '못 읽음' };

export default function TabsPage({ call, notify }: Props) {
  const [reads, setReads] = useState<TabRead[] | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const reply = await call('GET', 'reads');
    if (reply.ok) setReads((reply.data as { reads: TabRead[] }).reads);
    else notify(reply.message);
  }, [call, notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const reply = await call('POST', 'reads', { url });
    setBusy(false);
    if (!reply.ok) return notify(reply.message);
    setUrl('');
    notify('읽기를 요청했어요');
    load();
  }

  return (
    <div className="stack">
      <form className="panel" onSubmit={submit}>
        <label className="field">
          <span>읽을 주소</span>
          <input
            type="url"
            required
            value={url}
            placeholder="https://"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <p className="note">
          러너가 로그인된 브라우저 탭으로 열어 글자만 읽어요. 클릭 · 입력은 하지 않아요
        </p>
        <button type="submit" className="cta small fit" disabled={busy || url === ''}>
          읽기 요청
        </button>
      </form>
      {reads === null ? (
        <p className="note">불러오는 중</p>
      ) : reads.length === 0 ? (
        <p className="note">아직 읽은 탭 없음</p>
      ) : (
        <ul className="list">
          {reads.map((r) => (
            <li key={r.id} className="panel">
              <b>{r.title ?? r.url}</b>
              <span className="label-mono">
                {STATUS[r.status] ?? r.status} · {r.url}
              </span>
              {r.preview && <p className="note">{r.preview}</p>}
              {r.error && <p className="note">{r.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
