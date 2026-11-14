import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { Props, Site } from './browser-types';

// 사이트(로그인된 프로필로 일할 곳)와 둘러보기(로그인 없는 새 창) 맡기기. 사이트마다 로그인 필요 표시와 세션 지우기.

const originsOf = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .map((o) => o.trim())
    .filter(Boolean);

export function Sites({ call, notify }: Props) {
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
    notify('사이트를 삭제했어요');
    load();
  }

  return (
    <section className="stack" aria-label="사이트">
      <Explore call={call} notify={notify} />
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

/** 둘러보기: 로그인 없는 새 창으로 공개 사이트를 조사한다 (내부 주소는 막힌다) */
function Explore({ call, notify }: Props) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);

  async function ask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const reply = await call('POST', 'explore', { requestId: crypto.randomUUID(), instruction });
    setBusy(false);
    if (!reply.ok) return notify(reply.message);
    setInstruction('');
    notify('둘러보기를 맡겼어요. 작업 메뉴에서 진행을 볼 수 있어요');
  }

  return (
    <form className="panel" onSubmit={ask}>
      <b>둘러보기</b>
      <label className="field">
        <span>조사할 것</span>
        <textarea
          required
          rows={4}
          value={instruction}
          placeholder="예: 14인치 노트북 세 모델의 가격과 무게를 비교해 주세요"
          onChange={(e) => setInstruction(e.target.value)}
        />
      </label>
      <p className="note">
        로그인 없는 새 창으로 공개 사이트만 열어요. 이 서버 · 내부망 주소는 막혀 있고 제출 · 결제는
        하지 않아요
      </p>
      <button type="submit" className="cta small fit" disabled={busy || instruction === ''}>
        맡기기
      </button>
    </form>
  );
}

/** 사이트 하나: 로그인 필요 표시, 일 맡기기, 세션 지우기, 삭제 */
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

  async function clear() {
    if (
      !window.confirm(`${site.name}의 로그인(쿠키 · 저장소)을 지울까요? 다른 사이트는 그대로예요`)
    )
      return;
    setBusy(true);
    const reply = await call('POST', `sites/${site.id}/clear-session`, {});
    setBusy(false);
    notify(
      reply.ok ? '세션을 지웠어요. 다음 일 전에 화면에서 다시 로그인해 주세요' : reply.message,
    );
  }

  return (
    <li className="panel">
      <b>
        {site.name}
        {site.loginNeededAt && ' · 로그인 필요'}
      </b>
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
              '채울 제목과 본문을 여기에 적어 주세요.\n마지막 버튼 앞에서 멈추고, 결재하면 러너가 같은 버튼인지 확인하고 눌러요'
            }
            onChange={(e) => setInstruction(e.target.value)}
          />
        </label>
        <p className="note">
          에이전트는 글 · 소재 · 비공개 세션을 읽지 못해요. 채울 내용은 모두 여기에 적어 주세요
        </p>
        <button type="submit" className="cta small fit" disabled={busy || instruction === ''}>
          맡기기
        </button>
      </form>
      <div className="row">
        <button type="button" className="ghost small fit" disabled={busy} onClick={clear}>
          세션 지우기
        </button>
        <button type="button" className="ghost small fit" onClick={() => onRemove(site)}>
          삭제
        </button>
      </div>
    </li>
  );
}
