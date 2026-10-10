import type { INestApplication } from '@nestjs/common';

// 서버(main.api.ts)와 API 테스트 도구가 똑같이 거는 HTTP 설정.
// 리버스 프록시 뒤에서 https·접속 IP를 바르게 읽도록, 같은 컴퓨터·내부망의 프록시만 믿는다.
// biome-ignore lint/complexity/noStaticOnlyClass: 진입점 두 곳이 같은 설정을 쓰게 하는 한 곳
export class HttpSetup {
  static apply(app: INestApplication): void {
    const express = app.getHttpAdapter().getInstance() as {
      set(key: string, value: unknown): void;
    };
    express.set('trust proxy', 'loopback, linklocal, uniquelocal');
  }
}
