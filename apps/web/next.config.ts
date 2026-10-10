import type { NextConfig } from 'next';

// 외부 주소는 하나: /api · /mcp · /oauth · /.well-known 은 서버로, 나머지는 웹.
// 운영에서는 리버스 프록시가 나누고, 웹 하나만 열어 둔 개발 환경에서는 여기서 서버로 넘긴다.
const server = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
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
