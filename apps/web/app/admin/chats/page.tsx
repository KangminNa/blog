import { ChatPanel } from './ChatPanel';

export const metadata = { title: '대화 · Cairn', robots: { index: false } };

// 대화 메뉴: 관리자 바로 아래 에이전트와 채팅처럼 주고받는다 (메시지 하나 = 작업 하나).
// 고른 대화는 주소(?chat=)에 둔다: 새로 고쳐도 그 대화로, 폰에서는 목록과 대화를 하나씩.
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>;
}) {
  const { chat } = await searchParams;
  return (
    <section className="console-inner wide" aria-label="대화">
      <header className="page-head">
        <h1>대화</h1>
      </header>
      <ChatPanel chatId={chat ?? null} />
    </section>
  );
}
