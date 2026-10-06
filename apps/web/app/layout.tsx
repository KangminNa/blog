import type { ReactNode } from 'react';

export const metadata = {
  title: 'Cairn',
  description: 'AI 작업 세션을 모아 그래프로 키우고 블로그 글로 쓰는 블로그 엔진',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#11110F',
          color: '#ECE7DD',
          fontFamily: '"IBM Plex Sans KR", "Apple SD Gothic Neo", system-ui, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
