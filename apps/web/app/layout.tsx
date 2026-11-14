import type { ReactNode } from 'react';
import type { SpaceInfo } from './_account/types';
import { serverGet } from './_lib/server-api';
import './globals.css';

/** 사이트 로고를 올렸으면 브라우저 탭 아이콘으로도 쓴다 */
export async function generateMetadata() {
  const space = await serverGet<SpaceInfo>('/api/space', true);
  return {
    title: 'Cairn',
    description: '내 서버에서 도는 Personal AI OS. AI 세션, 작업, 블로그를 한곳에서',
    ...(space?.logoUrl ? { icons: { icon: space.logoUrl } } : {}),
  };
}

// AGPL-3.0: 서비스를 쓰는 사람도 소스를 받을 수 있게 모든 화면에 링크를 둔다
const SOURCE_URL = process.env.CAIRN_SOURCE_URL ?? 'https://github.com/KangminNa/blog';

// 고른 테마를 첫 그림 전에 적용한다 (고르지 않았으면 기기 설정을 따른다)
const THEME_SCRIPT =
  "try{var t=localStorage.getItem('cairn-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 고정된 문자열, 입력값 없음 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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
