import { type FormEvent, useCallback, useEffect, useState } from 'react';

// browser-tabs의 콘솔 화면 (운영 › 브라우저). 서버 브라우저(로그인된 프로필)로 하는 일을 한곳에서 본다.
//   화면: 배포 서버의 브라우저를 실시간으로 본다 (/browser/, Caddy가 주인만 넘긴다). 로그인 · 마지막 발행은 여기서 직접
//   사이트: 에이전트가 일할 곳 (이름 · 시작 주소 · 허용 출처). 일을 맡기면 서버 러너의 AI가 그 사이트에서 일한다
//   탭 읽기: 주소를 넣으면 러너가 탭으로 열어 글자만 읽는다 (AI 없음)
// 화면은 react와 이 폴더만 가져온다: 서버 호출(call)과 알림(notify)은 콘솔이 넘겨 준다.

type Reply = { ok: true; data: unknown } | { ok: false; message: string };
type Props = {
  call: (method: string, path: string, body?: object) => Promise<Reply>;
  notify: (text: string) => void;
};
type Site = {
  id: string;
  name: string;
  startUrl: string;
  origins: string[];
  version: number;
  updatedAt: string;
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
/** 배포 서버에서 Caddy가 브라우저 화면을 넘기는 경로 */
const VIEWER = '/browser/';

const originsOf = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .map((o) => o.trim())
    .filter(Boolean);

export default function BrowserPage({ call, notify }: Props) {
  return (
    <div className="stack">
      <Viewer />
      <Sites call={call} notify={notify} />
      <Reads call={call} notify={notify} />
    </div>
  );
}

/** 내 컴퓨터(개발)에서 연 콘솔인가. 앞단 프록시가 없어 /browser/가 열리지 않는다 */
const isLocal = () => ['localhost', '127.0.0.1'].includes(window.location.hostname);
/** 내 컴퓨터에서 화면 페이지가 열리는 곳 (BROWSER_VIEW_PORT 기본값) */
const LOCAL_VIEWER = 'http://localhost:4100';

/** 실시간 화면. 볼 때만 연다 (화면 전송은 CPU를 쓴다) */
function Viewer() {
  const [open, setOpen] = useState(false);
  // 서버에서 그린 첫 화면과 맞추려고 주소는 화면이 뜬 뒤에 본다
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(isLocal()), []);
  if (local)
    return (
      <section className="panel" aria-label="브라우저 화면">
        <b>화면</b>
        <p className="note">
          내 컴퓨터에서는 화면 칸 대신 새 탭으로 열어요 (.env의 CAIRN_BROWSER_PASSWORD로 들어가요)
        </p>
        <a className="cta small fit" href={LOCAL_VIEWER} target="_blank" rel="noopener">
          새 탭에서 화면 열기
        </a>
      </section>
    );
  return (
    <section className="panel" aria-label="브라우저 화면">
      <b>화면</b>
      <p className="note">
        서버 브라우저를 실시간으로 봐요. 사이트에 로그인하고, 에이전트가 결재를 올리면 여기서 직접
        발행해요. 배포 서버에서만 열려요
      </p>
      {open ? (
        <iframe
          title="서버 브라우저"
          src={VIEWER}
          allow="autoplay; clipboard-read; clipboard-write"
          style={{ width: '100%', height: 600, border: 0 }}
        />
      ) : null}
      <button type="button" className="cta small fit" onClick={() => setOpen(!open)}>
        {open ? '화면 닫기' : '화면 열기'}
      </button>
    </section>
  );
}

function Sites({ call, notify }: Props) {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [name, setName] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [origins, setOrigins] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const reply = await call('GET', 'sites');
    if (reply.ok) setSites((reply.data as { sites: Site[] }).sites);
    else notify(reply.message);
  }, [call, notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const reply = await call('POST', 'sites', { name, startUrl, origins: originsOf(origins) });
    setBusy(false);
    if (!reply.ok) return notify(reply.message);
    setName('');
    setStartUrl('');
    setOrigins('');
    notify('사이트를 등록했어요. 화면에서 로그인해 두세요');
    load();
  }

  async function remove(site: Site) {
    const reply = await call('DELETE', `sites/${site.id}`, { version: site.version });
    if (!reply.ok) return notify(reply.message);
    notify('사이트를 지웠어요');
    load();
  }

  return (
    <section className="stack" aria-label="사이트">
      <form className="panel" onSubmit={add}>
        <b>사이트 등록</b>
        <label className="field">
          <span>이름</span>
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>시작 주소</span>
          <input
            type="url"
            required
            value={startUrl}
            placeholder="https://blog.example/write"
            onChange={(e) => setStartUrl(e.target.value)}
          />
        </label>
        <label className="field">
          <span>허용 출처 (여럿이면 띄어 쓰기)</span>
          <input
            required
            value={origins}
            placeholder="https://blog.example"
            onChange={(e) => setOrigins(e.target.value)}
          />
        </label>
        <p className="note">
          에이전트는 이 출처 안에서만 움직여요. 자동화용 계정으로 로그인하길 권해요
        </p>
        <button type="submit" className="cta small fit" disabled={busy}>
          등록
        </button>
      </form>
      {sites === null ? (
        <p className="note">불러오는 중</p>
      ) : sites.length === 0 ? (
        <p className="note">아직 등록한 사이트 없음</p>
      ) : (
        <ul className="list">
          {sites.map((s) => (
            <SiteItem key={s.id} site={s} call={call} notify={notify} onRemove={remove} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** 사이트 하나: 일 맡기기와 지우기 */
function SiteItem({
  site,
  call,
  notify,
  onRemove,
}: Props & { site: Site; onRemove: (site: Site) => void }) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);

  async function ask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const reply = await call('POST', `sites/${site.id}/tasks`, {
      requestId: crypto.randomUUID(),
      instruction,
    });
    setBusy(false);
    if (!reply.ok) return notify(reply.message);
    setInstruction('');
    notify('일을 맡겼어요. 작업 메뉴에서 진행을 볼 수 있어요');
  }

  return (
    <li className="panel">
      <b>{site.name}</b>
      <span className="label-mono">
        {site.startUrl} · 허용 {site.origins.join(', ')}
      </span>
      <form className="stack" onSubmit={ask}>
        <label className="field">
          <span>맡길 일</span>
          <textarea
            required
            rows={8}
            value={instruction}
            placeholder={
              '편집기에 채울 제목과 본문을 여기에 적어 주세요.\n발행 직전에 멈추고 결재를 올려요'
            }
            onChange={(e) => setInstruction(e.target.value)}
          />
        </label>
        <p className="note">
          에이전트는 글 · 소재 · 비공개 세션을 읽지 못해요. 채울 내용은 모두 여기에 적어 주세요
        </p>
        <button type="submit" className="cta small fit" disabled={busy || instruction === ''}>
          일 맡기기
        </button>
      </form>
      <button type="button" className="small fit" onClick={() => onRemove(site)}>
        지우기
      </button>
    </li>
  );
}

function Reads({ call, notify }: Props) {
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
    <section className="stack" aria-label="탭 읽기">
      <form className="panel" onSubmit={submit}>
        <b>탭 읽기</b>
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
        <div className="row">
          <button type="submit" className="cta small fit" disabled={busy || url === ''}>
            읽기 요청
          </button>
          <button type="button" className="small fit" onClick={() => load()}>
            새로고침
          </button>
        </div>
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
    </section>
  );
}
