import type { INestApplication } from '@nestjs/common';

// 서버(main.api.ts)와 API 테스트 도구가 똑같이 거는 HTTP 설정.
// - 리버스 프록시 뒤에서 https·접속 IP를 바르게 읽도록, 같은 컴퓨터·내부망의 프록시만 믿는다.
// - 모든 응답은 캐시에 남지 않게(no-store) 하고, 서버 종류를 알리지 않는다.
//   나중에 캐시해도 되는 공개 응답(글 등)은 그 Response에서만 Cache-Control을 바꾼다.
// - JSON 본문은 512KB까지 (save_session 한 번의 최대 크기가 들어가게).
// biome-ignore lint/complexity/noStaticOnlyClass: 진입점 두 곳이 같은 설정을 쓰게 하는 한 곳
export class HttpSetup {
  static readonly JSON_LIMIT = '512kb';

  static apply(app: INestApplication): void {
    const express = app.getHttpAdapter().getInstance() as {
      set(key: string, value: unknown): void;
      disable(key: string): void;
      use(
        handler: (
          req: unknown,
          res: { setHeader(name: string, value: string): void },
          next: () => void,
        ) => void,
      ): void;
    };
    express.set('trust proxy', 'loopback, linklocal, uniquelocal');
    express.disable('x-powered-by');
    express.use((_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    });
    // Nest가 기본으로 거는 JSON 읽기 대신 한도를 정한 것을 건다 (Express 어댑터의 메서드)
    (
      app as unknown as { useBodyParser(type: 'json', options: { limit: string }): void }
    ).useBodyParser('json', { limit: HttpSetup.JSON_LIMIT });
  }
}
