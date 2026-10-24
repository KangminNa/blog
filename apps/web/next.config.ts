import type { NextConfig } from 'next';

// 외부 주소는 하나: /api · /mcp · /oauth · /.well-known 은 서버로, 나머지는 웹.
// 운영에서는 리버스 프록시가 나누고, 웹 하나만 열어 둔 개발 환경에서는 여기서 서버로 넘긴다.
const server = process.env.API_URL ?? 'http://localhost:4000';

// 개발 서버(next dev)는 localhost가 아닌 주소에서 온 개발용 요청(/_next/hmr 등)을 막고, 막히면 화면의 JS가 돌지 않는다.
// 테스트 서버처럼 도메인으로 여는 개발 서버를 위해 사람이 여는 웹 주소(CAIRN_WEB_URL)의 호스트를 허락한다.
// 운영 빌드(next start)에는 상관없는 설정이다.
function devOrigins(): string[] {
  try {
    return process.env.CAIRN_WEB_URL ? [new URL(process.env.CAIRN_WEB_URL).hostname] : [];
  } catch {
    return [];
  }
}

// 모든 화면에 붙이는 보안 머리글.
//   frame-ancestors · X-Frame-Options: 다른 사이트가 우리 화면을 겹쳐 놓고 누르게 하지 못하게
//   form-action: 폼은 이 사이트로만 (화면의 폼은 모두 fetch로 보낸다)
//   Referrer-Policy: 다른 사이트로 갈 때 도메인만 넘기고 경로·파라미터는 넘기지 않게
//   Strict-Transport-Security: https로 한 번 온 브라우저는 늘 https로 (http에서는 브라우저가 무시)
// 스크립트 출처까지 막는 전체 CSP는 블로그 화면(M4)에서 플러그인의 외부 스크립트와 함께 정한다.
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: devOrigins(),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${server}/api/:path*` },
      { source: '/mcp', destination: `${server}/mcp` },
      { source: '/oauth/:path*', destination: `${server}/oauth/:path*` },
      { source: '/.well-known/:path*', destination: `${server}/.well-known/:path*` },
    ];
  },
};

export default config;
