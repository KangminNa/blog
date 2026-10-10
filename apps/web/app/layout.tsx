import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Cairn',
  description: 'AI 작업 세션을 모아 그래프로 키우고 블로그 글로 쓰는 블로그 엔진',
};

// AGPL-3.0: 서비스를 쓰는 사람도 소스를 받을 수 있게 모든 화면에 링크를 둔다
const SOURCE_URL = process.env.CAIRN_SOURCE_URL ?? 'https://github.com/KangminNa/blog';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        {children}
        <a className="source" href={SOURCE_URL} rel="noopener">
          소스 · AGPL-3.0
        </a>
      </body>
    </html>
  );
}
