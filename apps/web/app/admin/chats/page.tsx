import { redirect } from 'next/navigation';

// 대화는 /admin/chats/<id> (2차 1-5). 예전 주소(?chat=)와 목록 주소는 그 대화나 새 대화로 보낸다
export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>;
}) {
  const { chat } = await searchParams;
  redirect(chat ? `/admin/chats/${encodeURIComponent(chat)}` : '/admin');
}
