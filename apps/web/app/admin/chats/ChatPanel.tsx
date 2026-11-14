'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { type ChatStart, ChatStartForm } from '../../_task/ChatStartForm';
import { when } from '../../_task/labels';
import { CHAT_TOPICS, useAgents } from '../../_task/live';
import type { Chat, ChatList, ChatSummary } from '../../_task/types';
import { ChatThreadPanel } from './ChatThreadPanel';

/** 일하는 중인 회차의 상태 */
const WAITING = ['queued', 'running', 'waiting'];
/** 프로젝트가 없는 대화의 묶음 이름 */
const NO_PROJECT = '프로젝트 없음';

// 대화: 왼쪽은 프로젝트별 대화 목록(최근에 보낸 것부터), 오른쪽은 고른 대화 또는 새 대화.
// 상대는 관리자 바로 아래 에이전트만 (팀원과는 그 팀장을 거쳐 이야기한다), 비우면 기본 대표. 막는 것은 서버.
export function ChatPanel({ chatId }: { chatId: string | null }) {
  const list = useLiveValue('chats', () => api<ChatList>('GET', '/api/chats'), CHAT_TOPICS);
  const agents = useAgents();
  const action = useAction();
  const router = useRouter();
  const [fresh, setFresh] = useState(false);
  /** 응답을 못 받아 다시 눌러도 대화가 하나만 생기게 */
  const requestId = useRef('');
  if (!requestId.current) requestId.current = crypto.randomUUID();

  const chats = list.data?.chats ?? null;
  const writing = fresh || (chatId === null && chats?.length === 0);
  const partners = (agents.data?.agents ?? []).filter(
    (a) => a.reportsTo === null && a.status !== 'paused',
  );

  const projects = [...new Set((chats ?? []).flatMap((c) => (c.project ? [c.project] : [])))];
  const groups = groupOf(chats ?? []);

  async function start(body: ChatStart) {
    const reply = await action.run(
      'start',
      () => api<Chat>('POST', '/api/chats', { requestId: requestId.current, ...body }),
      { reload: list.reload },
    );
    if (!reply?.ok) return;
    requestId.current = crypto.randomUUID();
    setFresh(false);
    router.push(`/admin/chats?chat=${reply.data.id}`);
  }

  return (
    <>
      {list.error && <p className="error">{list.error}</p>}
      <div className={chatId || writing ? 'split chat-split picked' : 'split chat-split'}>
        <div className="split-list">
          <button type="button" className="cta small" onClick={() => setFresh(true)}>
            새 대화
          </button>
          {chats === null ? (
            !list.error && <p className="label-mono">불러오는 중…</p>
          ) : chats.length === 0 ? (
            <p className="rows-empty">대화 없음</p>
          ) : (
            groups.map(([project, rows]) => (
              <section key={project} className="chat-group" aria-label={project}>
                <h3 className="label-mono">{project}</h3>
                <ul className="list">
                  {rows.map((c) => (
                    <li key={c.id}>
                      <ChatItem
                        chat={c}
                        on={!writing && c.id === chatId}
                        onPick={() => setFresh(false)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className="split-detail">
          {writing ? (
            <section className="panel" aria-labelledby="new-chat">
              <div className="sec-title flat">
                <h2 id="new-chat">새 대화</h2>
                <button type="button" className="ghost split-back" onClick={() => setFresh(false)}>
                  대화 목록
                </button>
              </div>
              {partners.length === 0 ? (
                <p className="note">
                  대화할 에이전트 없음. 관리자 바로 아래 에이전트(보고 대상 없음)와 대화해요.{' '}
                  <Link href="/admin/agents">에이전트 추가</Link>
                </p>
              ) : (
                <ChatStartForm
                  partners={partners}
                  projects={projects}
                  busy={action.busy !== null}
                  problem={action.problem}
                  onSubmit={start}
                />
              )}
            </section>
          ) : chatId ? (
            <ChatThreadPanel key={chatId} id={chatId} />
          ) : (
            <p className="rows-empty">대화를 고르거나 새 대화를 시작해요</p>
          )}
        </div>
      </div>
    </>
  );
}

function ChatItem({ chat, on, onPick }: { chat: ChatSummary; on: boolean; onPick: () => void }) {
  const waiting = chat.lastStatus !== null && WAITING.includes(chat.lastStatus);
  return (
    <Link
      className="item"
      href={`/admin/chats?chat=${chat.id}`}
      aria-current={on ? 'true' : undefined}
      onClick={onPick}
    >
      <div className="item-main">
        <b className="clamp">{chat.title}</b>
        <small className="clamp">
          {chat.deviceId ? '기기에서 · ' : ''}
          {chat.agentName} · {when(chat.updatedAt)}
        </small>
      </div>
      {waiting && (
        <span className="pill">
          {chat.lastWaitReason === 'approval' ? '결재 대기' : '일하는 중'}
        </span>
      )}
    </Link>
  );
}

/** 프로젝트별로 묶는다 (가장 최근에 바뀐 대화가 있는 묶음부터, 프로젝트 없음은 맨 뒤) */
function groupOf(chats: readonly ChatSummary[]): [string, ChatSummary[]][] {
  const groups = new Map<string, ChatSummary[]>();
  for (const c of chats) {
    const key = c.project ?? NO_PROJECT;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups].sort(([a], [b]) => Number(a === NO_PROJECT) - Number(b === NO_PROJECT));
}
