import { type FormEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

// 서버 브라우저 화면 (2026-11-14): 영상(neko · UDP) 없이 HTTPS로 화면 그림을 받고, 클릭 · 글자 · 키를 보낸다.
// 열려 있고 이 탭이 보일 때만 1초마다 새로 그린다 (그림 하나는 수십 KB). 동작을 보내면 곧 다시 그린다.
// 그림을 누르면 그 자리를 클릭하고, 그다음 키보드로 치는 글자가 서버 브라우저로 간다 (보이지 않는 입력 칸이 받는다).
//   한글은 조합이 끝난 글자만 보내고, 붙여 넣기도 같은 길로 간다. 친 글자는 보내자마자 지워 이 화면에 남지 않는다 (비밀번호).
//   보내기는 차례대로 한다: 빠르게 쳐도 순서가 섞이지 않는다.

type Reply = { ok: true; data: unknown } | { ok: false; message: string };
type Call = (method: string, path: string, body?: object) => Promise<Reply>;
type Tab = { id: string; title: string; url: string };
type Shot = { tabs: Tab[]; tab: string; image: string; width: number; height: number };

/** 새로 그리는 간격 */
const EVERY_MS = 1000;
/** 동작을 보낸 뒤 다시 그리기까지 (연달아 칠 때 한 번만) */
const AFTER_MS = 250;
/** 누른 자리 동그라미가 보이는 시간 */
const RING_MS = 1200;
/** 휠을 모아 보내는 간격 */
const WHEEL_MS = 120;
/** 위 · 아래 버튼 한 번에 굴리는 양 (CSS 픽셀) */
const SCROLL = 400;
/** 글자가 아니라 키로 보내는 것 (서버의 BrowserScreenGateway.KEY_NAMES와 같게) */
const KEYS = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export function Screen({ call }: { call: Call }) {
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  // 키보드가 서버 브라우저로 가는 중인가
  const [typing, setTyping] = useState(false);
  // 마지막으로 누른 자리 (그림 대비 %). 입력 칸이 이 자리에 있고(폰 키보드가 이 근처를 보게), 동그라미는 잠깐만 보인다
  const [mark, setMark] = useState<{ x: number; y: number } | null>(null);
  const [ring, setRing] = useState(false);
  // 고른 탭. 비우면 서버가 맨 앞 탭을 그린다
  const tab = useRef<string | null>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const picture = useRef<HTMLButtonElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const redraw = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  /** 동작을 차례대로 보내고, 다 보낸 뒤 곧 다시 그린다 */
  const send = useCallback(
    (body: Record<string, unknown>) => {
      queue.current = queue.current.then(async () => {
        if (!tab.current) return;
        const reply = await call('POST', 'screen/control', { tab: tab.current, ...body });
        if (!reply.ok) setProblem(reply.message);
      });
      clearTimeout(redraw.current);
      redraw.current = setTimeout(() => void queue.current.then(draw), AFTER_MS);
    },
    [call, draw],
  );

  // 누른 자리 동그라미는 잠깐만
  useEffect(() => {
    if (!ring) return;
    const timer = setTimeout(() => setRing(false), RING_MS);
    return () => clearTimeout(timer);
  }, [ring]);

  // 휠: 화면 그림 위에서 굴리면 서버 브라우저가 스크롤된다 (콘솔 쪽은 움직이지 않게 passive가 아닌 듣기로)
  useEffect(() => {
    const target = picture.current;
    if (!target || !shot) return;
    let dy = 0;
    let at = { x: 0, y: 0 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = target.getBoundingClientRect();
      at = {
        x: Math.round(((e.clientX - box.left) / box.width) * shot.width),
        y: Math.round(((e.clientY - box.top) / box.height) * shot.height),
      };
      dy += e.deltaY;
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        const amount = Math.max(-5000, Math.min(5000, Math.round(dy)));
        dy = 0;
        if (amount !== 0)
          send({ type: 'scroll', x: Math.max(0, at.x), y: Math.max(0, at.y), dy: amount });
      }, WHEEL_MS);
    };
    target.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      target.removeEventListener('wheel', onWheel);
      clearTimeout(timer);
    };
  }, [shot, send]);

  /** 그림 위 누른 자리를 클릭하고, 키보드를 서버 브라우저로 돌린다 */
  function click(e: MouseEvent<HTMLButtonElement>) {
    if (!shot) return;
    const box = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    setMark({ x: fx * 100, y: fy * 100 });
    setRing(true);
    send({
      type: 'click',
      x: Math.max(0, Math.round(fx * shot.width)),
      y: Math.max(0, Math.round(fy * shot.height)),
    });
    keys.current?.focus({ preventScroll: true });
  }

  /** 보이지 않는 입력 칸에 쌓인 글자를 보내고 비운다 */
  function flush() {
    const box = keys.current;
    if (!box?.value) return;
    const text = box.value;
    box.value = '';
    send({ type: 'text', text });
  }

  function go(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    send({ type: 'navigate', url: url.trim() });
  }

  function pick(id: string) {
    tab.current = id;
    send({ type: 'activate' });
  }

  return (
    <section className="panel" aria-label="브라우저 화면">
      <b>화면</b>
      <p className="note">
        화면을 누르면 그 자리를 클릭하고, 이어서 키보드로 치면 서버 브라우저에 들어가요 (한글 · 붙여
        넣기 · Enter · Tab 포함). 휠로 스크롤해요. 사이트 로그인과 마지막 발행은 여기서 직접 해요
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
            <button type="button" className="ghost" onClick={() => send({ type: 'back' })}>
              뒤로
            </button>
            <button type="button" className="ghost" onClick={() => scrollBy(-SCROLL)}>
              위로
            </button>
            <button type="button" className="ghost" onClick={() => scrollBy(SCROLL)}>
              아래로
            </button>
          </div>
          <div
            style={{
              position: 'relative',
              outline: typing ? '2px solid currentColor' : '1px solid transparent',
              outlineOffset: 2,
            }}
          >
            <button
              ref={picture}
              type="button"
              onClick={click}
              aria-label="서버 브라우저 화면. 누른 자리를 클릭하고 이어서 키보드로 입력해요"
              style={{
                display: 'block',
                width: '100%',
                padding: 0,
                border: 0,
                background: 'none',
                cursor: 'crosshair',
              }}
            >
              <img
                src={`data:image/jpeg;base64,${shot.image}`}
                alt=""
                draggable={false}
                style={{ display: 'block', width: '100%', height: 'auto' }}
              />
            </button>
            {mark && ring && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: `${mark.x}%`,
                  top: `${mark.y}%`,
                  width: 18,
                  height: 18,
                  marginLeft: -9,
                  marginTop: -9,
                  border: '2px solid currentColor',
                  borderRadius: '50%',
                  pointerEvents: 'none',
                }}
              />
            )}
            <textarea
              ref={keys}
              aria-label="서버 브라우저에 입력"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
                if (!KEYS.has(e.key)) return;
                e.preventDefault();
                flush();
                send({ type: 'key', key: e.key });
              }}
              onInput={(e) => {
                // 한글 조합 중에는 기다렸다가 조합이 끝난 글자만 보낸다
                if (!(e.nativeEvent as InputEvent).isComposing) flush();
              }}
              onCompositionEnd={() => setTimeout(flush, 0)}
              style={{
                position: 'absolute',
                left: mark ? `${mark.x}%` : 0,
                top: mark ? `${mark.y}%` : 0,
                width: 1,
                height: 1,
                padding: 0,
                border: 0,
                opacity: 0,
                resize: 'none',
                overflow: 'hidden',
              }}
            />
          </div>
          {typing && (
            <p className="note">키보드가 서버 브라우저로 가요 · 화면 밖을 누르면 멈춰요</p>
          )}
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

  function scrollBy(dy: number) {
    if (!shot) return;
    send({ type: 'scroll', x: Math.round(shot.width / 2), y: Math.round(shot.height / 2), dy });
  }
}
