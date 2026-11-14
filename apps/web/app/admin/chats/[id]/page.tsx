import { ChatThreadPanel } from '../ChatThreadPanel';

export const metadata = { title: '대화 · Cairn', robots: { index: false } };

// 대화 하나 (2차 1-5): 왼쪽 대화 목록은 콘솔 틀(ChatNav)이 그린다
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatThreadPanel id={id} />;
}
