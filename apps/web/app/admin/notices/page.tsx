import { NoticesPanel } from './NoticesPanel';

export const metadata = { title: '알림 · Cairn', robots: { index: false } };

// 알림 설정: 묶음 간격 · 조용한 시간 · 종류별 경로, 이 브라우저에서 푸시 받기.
export default function NoticesPage() {
  return (
    <section className="console-inner" aria-label="알림">
      <NoticesPanel />
    </section>
  );
}
