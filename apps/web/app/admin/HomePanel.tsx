'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMe } from '../_account/live';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { type ChatStart, ChatStartForm } from '../_task/ChatStartForm';
import { CHAT_STATE, when } from '../_task/labels';
import { useAgents, useHome, useUsage } from '../_task/live';
import type { Chat, HomeChat } from '../_task/types';
import { UsageBlock } from '../_task/UsageBlock';

/** 홈에 펼쳐 두는 대화 수. 나머지는 대화 메뉴에서 본다 */
const CHATS_SHOWN = 6;

// 홈 (2차 1-4): 입력 하나로 대표에게 맡긴다 (상대 · 프로젝트 · 목표는 곁들임).
// 아래는 나에게 온 것(결재) · 진행 중인 대화 · 최근 결과물 · 팀. 맡긴 뒤에는 그 대화로 간다.
export function HomePanel() {
  const router = useRouter();
  const me = useMe();
  const home = useHome();
  const agents = useAgents();
  const usage = useUsage();
  const action = useAction();
  /** 응답을 못 받아 다시 눌러도 대화가 하나만 생기게 */
  const requestId = useRef('');
  if (!requestId.current) requestId.current = crypto.randomUUID();
  const [today, setToday] = useState('');

  // 서버와 브라우저의 시간대가 다를 수 있어 브라우저에서 정한다
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }),
    );
  }, []);

  const h = home.data;
  const partners = (agents.data?.agents ?? []).filter(
    (a) => a.reportsTo === null && a.status !== 'paused',
  );
  const projects = [...new Set((h?.chats ?? []).flatMap((c) => (c.project ? [c.project] : [])))];
  const open = (h?.chats ?? []).filter((c) => c.state !== 'done');
  const shown = (open.length > 0 ? open : (h?.chats ?? [])).slice(0, CHATS_SHOWN);

  async function start(body: ChatStart) {
    const reply = await action.run('start', () =>
      api<Chat>('POST', '/api/chats', { requestId: requestId.current, ...body }),
    );
    if (!reply?.ok) return;
    requestId.current = crypto.randomUUID();
    router.push(`/admin/chats?chat=${reply.data.id}`);
  }

  return (
    <section className="console-inner home" aria-label="홈">
      <header className="home-head">
        <p className="label-mono">{today || ' '}</p>
        <h1>{me.data?.name ? `${me.data.name}, 무엇을 맡길까요?` : '무엇을 맡길까요?'}</h1>
      </header>
      {agents.data && partners.length === 0 ? (
        <div className="panel">
          <b>맡길 에이전트 없음</b>
          <p className="note">관리자 바로 아래 에이전트가 대화의 상대예요. 팀 템플릿으로 한 번에</p>
          <Link className="cta small fit" href="/admin/agents?new=1">
            에이전트 추가
          </Link>
        </div>
      ) : (
        <ChatStartForm
          partners={partners}
          projects={projects}
          busy={action.busy !== null}
          problem={action.problem}
          onSubmit={start}
        />
      )}
      {home.error && <p className="error">{home.error}</p>}
      <div className="stats">
        <Link className="stat" href="/admin/approvals">
          <b>{h ? h.pendingApprovals : '–'}</b>
          <small>나에게 온 것</small>
        </Link>
        <Link className="stat" href="/admin/chats">
          <b>{h ? h.chats.filter((c) => c.state === 'working').length : '–'}</b>
          <small>일하는 대화</small>
        </Link>
        <Link className="stat" href="/admin/outputs">
          <b>{h ? h.outputs.length : '–'}</b>
          <small>최근 결과물</small>
        </Link>
      </div>
      <section aria-labelledby="home-chats">
        <div className="sec-title">
          <h2 id="home-chats">{open.length > 0 ? '진행 중인 대화' : '최근 대화'}</h2>
          <Link href="/admin/chats">전체 보기</Link>
        </div>
        {!h ? (
          <p className="rows-empty">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <p className="rows-empty">대화 없음. 위에서 맡기면 여기에 보여요</p>
        ) : (
          <ul className="list">
            {shown.map((c) => (
              <ChatRow key={c.id} chat={c} />
            ))}
          </ul>
        )}
      </section>
      {h && h.outputs.length > 0 && (
        <section aria-labelledby="home-outputs">
          <div className="sec-title">
            <h2 id="home-outputs">최근 결과물</h2>
            <Link href="/admin/outputs">전체 보기</Link>
          </div>
          <ul className="cards">
            {h.outputs.map((o) => (
              <li key={o.id}>
                <a className="card" href={`/api/outputs/${o.id}/file`} download={o.name}>
                  <b className="clamp">{o.name}</b>
                  <small>{when(o.createdAt)}</small>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="home-team">
        <div className="sec-title">
          <h2 id="home-team">팀</h2>
          <Link href="/admin/agents">에이전트</Link>
        </div>
        {h && h.team.length > 0 && (
          <ul className="list">
            {h.team.map((a) => (
              <li key={a.id}>
                <Link className="item" href="/admin/agents">
                  <div className="item-main">
                    <b>{a.name}</b>
                    <small className="clamp">
                      {firstLine(a.role) || '역할 없음'} · 팀원 {a.members}
                    </small>
                  </div>
                  {a.lead && <span className="pill">대표</span>}
                  {a.paused ? (
                    <span className="pill off">멈춤</span>
                  ) : (
                    a.open > 0 && <span className="pill strong">일 {a.open}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <UsageBlock usage={usage.data} agents={agents.data?.agents} />
    </section>
  );
}

function ChatRow({ chat }: { chat: HomeChat }) {
  return (
    <li>
      <Link className="item" href={`/admin/chats?chat=${chat.id}`}>
        <div className="item-main">
          <b className="clamp">{chat.title}</b>
          <small className="clamp">
            {chat.partner}
            {chat.project ? ` · ${chat.project}` : ''}
            {chat.goal ? ` · ${chat.goal}` : ''} · {when(chat.updatedAt)}
          </small>
        </div>
        <span className={chat.state === 'working' ? 'pill strong' : 'pill'}>
          {CHAT_STATE[chat.state] ?? chat.state}
          {chat.active > 0 && chat.state === 'working' ? ` · ${chat.active}` : ''}
        </span>
      </Link>
    </li>
  );
}

/** 역할의 첫 줄 (역할은 AI에게 주는 긴 글이라 홈에는 머리만) */
function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}
