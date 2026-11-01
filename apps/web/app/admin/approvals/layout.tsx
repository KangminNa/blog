import type { ReactNode } from 'react';
import { ApprovalsList } from './ApprovalsList';

// 목록은 레이아웃에 둔다: 결재를 골라도 목록과 거르기, 읽은 쪽이 그대로다.
export default function ApprovalsLayout({ children }: { children: ReactNode }) {
  return (
    <section className="console-inner wide" aria-label="결재">
      <header className="page-head">
        <h1>결재</h1>
      </header>
      <ApprovalsList>{children}</ApprovalsList>
    </section>
  );
}
