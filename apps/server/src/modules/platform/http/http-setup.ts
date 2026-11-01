import type { INestApplication } from '@nestjs/common';
import { TooLarge } from '../base/errors';

// 서버(main.api.ts)와 API 테스트 도구가 똑같이 거는 HTTP 설정.
// - 리버스 프록시 뒤에서 https·접속 IP를 바르게 읽도록, 같은 컴퓨터·내부망의 프록시만 믿는다.
// - 모든 응답은 캐시에 남지 않게(no-store) 하고, 서버 종류를 알리지 않는다.
//   나중에 캐시해도 되는 공개 응답(글 등)은 그 Response에서만 Cache-Control을 바꾼다.
// - JSON 본문은 512KB까지 (save_session 한 번의 최대 크기가 들어가게).
// - 이미지 본문은 주소가 /assets로 끝날 때만 그대로(Buffer) 받고 10MB까지. 다른 주소로 큰 본문을 보내 서버 메모리를 쓰게 두지 않는다. multipart는 쓰지 않는다. 형식은 머리글이 아니라 파일의 앞부분으로 받는 쪽이 본다.
// - 본문이 한도를 넘으면 다른 오류와 같은 모양으로 413.
/** 본문을 읽을지 고를 때 보는 요청 (Node의 IncomingMessage) */
type UploadRequest = { url?: string; headers: Record<string, string | string[] | undefined> };

// biome-ignore lint/complexity/noStaticOnlyClass: 진입점 두 곳이 같은 설정을 쓰게 하는 한 곳
export class HttpSetup {
  static readonly JSON_LIMIT = '512kb';
  static readonly IMAGE_LIMIT = '10mb';

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
      use(
        handler: (
          error: { type?: string },
          req: unknown,
          res: { status(code: number): { json(body: object): void } },
          next: (error: unknown) => void,
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
    const parsers = app as unknown as {
      useBodyParser(
        type: 'json' | 'raw',
        options: { limit: string; type?: (req: UploadRequest) => boolean },
      ): void;
    };
    parsers.useBodyParser('json', { limit: HttpSetup.JSON_LIMIT });
    parsers.useBodyParser('raw', { limit: HttpSetup.IMAGE_LIMIT, type: HttpSetup.isImageUpload });
    express.use(HttpSetup.tooLarge);
  }

  private static isImageUpload(req: UploadRequest): boolean {
    const type = String(req.headers['content-type'] ?? '');
    return type.startsWith('image/') && /\/assets(?:\?|$)/.test(req.url ?? '');
  }

  /** 본문 읽기의 오류. 인자가 넷이어야 Express가 오류 처리기로 부른다 */
  private static tooLarge(
    error: { type?: string },
    _req: unknown,
    res: { status(code: number): { json(body: object): void } },
    next: (error: unknown) => void,
  ): void {
    if (error.type !== 'entity.too.large') {
      next(error);
      return;
    }
    const tooLarge = new TooLarge('너무 큰 요청이에요');
    res.status(tooLarge.status).json(tooLarge.toJSON());
  }
}
