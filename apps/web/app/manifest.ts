import type { MetadataRoute } from 'next';

// 웹 앱 매니페스트 (7단계). 아이폰 · 아이패드는 사이트를 "홈 화면에 추가"한 앱에서만 웹 푸시를 받는다.
// 열면 콘솔로 간다. 색은 디자인의 흰 바탕 · 검은 글자와 같게 둔다 (CSS 토큰은 여기서 읽을 수 없다).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cairn',
    short_name: 'Cairn',
    start_url: '/admin',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#000000',
  };
}
