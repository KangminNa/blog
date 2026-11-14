import { ChatNewPanel } from './chats/ChatNewPanel';

export const metadata = { title: '새 대화 · Cairn', robots: { index: false } };

// 처음 화면은 대화다 (2차 1-5): 입력 하나로 맡기면 맞는 에이전트가 맡는다
export default function AdminHome() {
  return <ChatNewPanel />;
}
