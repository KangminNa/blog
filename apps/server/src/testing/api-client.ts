import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { type Actor, OwnerActor, SecretBox, VisitorActor } from '../modules/platform';

/** 테스트에서 요청하는 사람 */
export class TestAs {
  static readonly visitor = new TestAs('visitor', new VisitorActor());
  static readonly owner = new TestAs(
    'owner',
    new OwnerActor('00000000-0000-7000-8000-0000000000aa', 'tester'),
  );

  private constructor(
    readonly header: string,
    readonly actor: Actor,
  ) {}

  static from(header: unknown): TestAs | null {
    return [TestAs.visitor, TestAs.owner].find((a) => a.header === header) ?? null;
  }
}

/** 응답 하나: 상태 코드와 본문 */
export class ApiResult {
  constructor(
    readonly status: number,
    readonly text: string,
  ) {}

  /** 본문을 JSON으로 (테스트에서 값을 꺼내 비교할 때) */
  json(): Record<string, unknown> {
    return JSON.parse(this.text) as Record<string, unknown>;
  }
}

// API 테스트 도구: 실제 서버(AppModule)를 테스트 안에서 임의 포트로 띄우고 HTTP로 부른다.
// 로그인이 생기기 전이라, 요청 머리글 x-test-actor로 요청자를 정한다. 이 길은 이 도구에만 있고
// 실제 서버(main.api.ts)에는 없다.
//
//   const api = await ApiClient.start();
//   const res = await api.get('/plugins', TestAs.owner);
//   assert.equal(res.status, 200);
//   await api.close();
export class ApiClient {
  private constructor(
    private readonly app: INestApplication,
    private readonly baseUrl: string,
  ) {}

  static async start(): Promise<ApiClient> {
    process.env.CAIRN_SECRET_KEY ??= SecretBox.newKey();
    const app = await NestFactory.create(AppModule, { logger: false });
    app.use(
      (
        req: { headers: Record<string, unknown>; actor?: Actor },
        _res: unknown,
        next: () => void,
      ) => {
        const who = TestAs.from(req.headers['x-test-actor']);
        if (who) req.actor = who.actor;
        next();
      },
    );
    await app.listen(0, '127.0.0.1');
    return new ApiClient(app, await app.getUrl());
  }

  /** 서버 안의 객체를 꺼낸다 (화면·API가 아직 없는 동작을 준비할 때) */
  service<T>(type: new (...args: never[]) => T): T {
    return this.app.get(type);
  }

  request(
    method: string,
    path: string,
    as: TestAs = TestAs.visitor,
    body?: object,
  ): Promise<ApiResult> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'x-test-actor': as.header,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (res) => new ApiResult(res.status, await res.text()));
  }

  get(path: string, as: TestAs = TestAs.visitor): Promise<ApiResult> {
    return this.request('GET', path, as);
  }

  async close(): Promise<void> {
    await this.app.close();
  }
}
