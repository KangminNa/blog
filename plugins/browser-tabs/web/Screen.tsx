import { type FormEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

// 서버 브라우저 화면 (2026-11-14): 영상(neko · UDP) 없이 HTTPS로 화면 그림을 받고, 클릭 · 글자 · 키를 보낸다.
// 열려 있고 이 탭이 보일 때만 1초마다 새로 그린다 (그림 하나는 수십 KB). 누르면 바로 다시 그린다.
// 로그인 · 마지막 발행처럼 사람이 직접 할 일을 여기서 한다. 비밀번호는 "가려서 입력"으로 보낸다 (화면 칸에 보이지 않게).

type Reply = { ok: true; data: unknown } | { ok: false; message: string };
type Call = (method: string, path: string, body?: object) => Promise<Reply>;
type Tab = { id: string; title: string; url: string };
type Shot = { tabs: Tab[]; tab: string; image: string; width: number; height: number };

/** 새로 그리는 간격 */
const EVERY_MS = 1000;
/** 위 · 아래 버튼 한 번에 굴리는 양 (CSS 픽셀) */
const SCROLL = 400;
/** 보낼 수 있는 키 (서버의 BrowserScreenGateway.KEY_NAMES와 같게) */
const KEYS: [string, string][] = [
  ['Enter', 'Enter'],
  ['Tab', 'Tab'],
  ['Backspace', '지우기'],
  ['Escape', 'Esc'],
];

export function Screen({ call }: { call: Call }) {
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [hidden, setHidden] = useState(false);
  const [url, setUrl] = useState('');
  // 고른 탭. 비우면 서버가 맨 앞 탭을 그린다
  const tab = useRef<string | null>(null);

  const draw = useCallback(async () => {
    const path = tab.current ? `screen?tab=${encodeURIComponent(tab.current)}` : 'screen';
    const reply = await call('GET', path);
    if (!reply.ok) {
      setProblem(reply.message);
      return;
    }
    const next = reply.data as Shot;
    tab.current = next.tab;
    setShot(next);
    setProblem(null);
  }, [call]);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (!document.hidden) await draw();
      if (!stopped) timer = setTimeout(loop, EVERY_MS);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open, draw]);

  /** 동작을 보내고 바로 다시 그린다 */
  async function send(body: Record<string, unknown>) {
    if (!tab.current) return;
    const reply = await call('POST', 'screen/control', { tab: tab.current, ...body });
    if (!reply.ok) setProblem(reply.message);
    await draw();
  }

  /** 그림 위 누른 자리를 브라우저 화면의 좌표(CSS 픽셀)로 */
  function click(e: MouseEvent<HTMLButtonElement>) {
    if (!shot) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - box.left) / box.width) * shot.width);
    const y = Math.round(((e.clientY - box.top) / box.height) * shot.height);
    void send({ type: 'click', x: Math.max(0, x), y: Math.max(0, y) });
  }

  function scroll(dy: number) {
    if (!shot) return;
    void send({
      type: 'scroll',
      x: Math.round(shot.width / 2),
      y: Math.round(shot.height / 2),
      dy,
    });
  }

  function typeText(e: FormEvent) {
    e.preventDefault();
    if (!text) return;
    void send({ type: 'text', text });
    setText('');
  }

  function go(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    void send({ type: 'navigate', url: url.trim() });
  }

  function pick(id: string) {
    tab.current = id;
    void send({ type: 'activate' });
  }

  return (
    <section className="panel" aria-label="브라우저 화면">
      <b>화면</b>
      <p className="note">
        서버 브라우저를 그림으로 보고 누를 수 있어요. 사이트 로그인과 마지막 발행은 여기서 직접
        해요. 열려 있는 동안 1초마다 새로 그려요
      </p>
      {open && problem && <p className="error">{problem}</p>}
      {open && shot && (
        <>
          <div className="row">
            <label className="field">
              <span>탭</span>
              <select className="input" value={shot.tab} onChange={(e) => pick(e.target.value)}>
                {shot.tabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title || t.url}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="ghost" onClick={() => void send({ type: 'back' })}>
              뒤로
            </button>
            <button type="button" className="ghost" onClick={() => scroll(-SCROLL)}>
              위로
            </button>
            <button type="button" className="ghost" onClick={() => scroll(SCROLL)}>
              아래로
            </button>
          </div>
          <button
            type="button"
            onClick={click}
            aria-label="서버 브라우저 화면. 누른 자리를 클릭해요"
            style={{ display: 'block', width: '100%', padding: 0, border: 0, cursor: 'crosshair' }}
          >
            <img
              src={`data:image/jpeg;base64,${shot.image}`}
              alt=""
              style={{ display: 'block', width: '100%', height: 'auto' }}
            />
          </button>
          <form className="row" onSubmit={typeText}>
            <label className="field">
              <span>글자 보내기 (누른 칸에 들어가요)</span>
              <input
                className="input"
                type={hidden ? 'password' : 'text'}
                value={text}
                autoComplete="off"
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label className="note">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
              />{' '}
              가려서 입력
            </label>
            <button type="submit" className="ghost">
              보내기
            </button>
            {KEYS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="ghost"
                onClick={() => void send({ type: 'key', key })}
              >
                {label}
              </button>
            ))}
          </form>
          <form className="row" onSubmit={go}>
            <label className="field">
              <span>주소로 가기</span>
              <input
                className="input"
                type="url"
                placeholder="https://"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <button type="submit" className="ghost">
              가기
            </button>
          </form>
        </>
      )}
      <button type="button" className="cta small fit" onClick={() => setOpen(!open)}>
        {open ? '화면 닫기' : '화면 열기'}
      </button>
    </section>
  );
}
