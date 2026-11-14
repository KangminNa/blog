'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useMe } from '../../_account/live';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import type { Chat } from '../../_task/types';
import { ChatForm } from './ChatForm';

// 새 대화 (2차 1-5, 처음 화면): 인사와 입력 하나. 상대 · 프로젝트 · 받을 것은 고르지 않는다:
// 맞는 에이전트가 맡고(배정), 애매하면 대화에서 묻는다. 보내면 그 대화로 간다
export function ChatNewPanel() {
  const me = useMe();
  const action = useAction();
  const router = useRouter();
  /** 응답을 못 받아 다시 보내도 대화가 하나만 생기게 */
  const requestId = useRef('');
  if (!requestId.current) requestId.current = crypto.randomUUID();
  const name = me.data?.name;

  async function start(body: { message: string }) {
    const reply = await action.run('start', () =>
      api<Chat>('POST', '/api/chats', { requestId: requestId.current, ...body }),
    );
    if (!reply?.ok) return;
    requestId.current = crypto.randomUUID();
    router.push(`/admin/chats/${reply.data.id}`);
  }

  return (
    <section className="chat-home" aria-labelledby="chat-home-title">
      <h1 id="chat-home-title">{name ? `${name}, 무엇을 맡길까요?` : '무엇을 맡길까요?'}</h1>
      <ChatForm
        busy={action.busy !== null}
        problem={action.problem}
        blocked={null}
        hint={null}
        rows={3}
        onSubmit={start}
      />
      <p className="note">맞는 에이전트가 알아서 맡아요. 애매하면 대화로 물어봐요</p>
    </section>
  );
}
