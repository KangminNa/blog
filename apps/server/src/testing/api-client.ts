import { createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { InstallPolicy } from '../modules/account';
import { HttpSetup, SecretBox } from '../modules/platform';

/** 테스트에서 요청하는 사람: 쿠키 묶음. 방문자는 쿠키가 없다 */
export class TestUser {
  static readonly visitor = new TestUser({});

  constructor(readonly cookies: Readonly<Record<string, string>>) {}

  with(more: Readonly<Record<string, string>>): TestUser {
    return new TestUser({ ...this.cookies, ...more });
  }

  get header(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
  }
}

/** 응답 하나: 상태 코드, 본문, 머리글 (쿠키, 다른 주소로 보내기) */
export class ApiResult {
  constructor(
    readonly status: number,
    readonly text: string,
    private readonly headers: Headers,
  ) {}

  /** 본문을 JSON으로 (테스트에서 값을 꺼내 비교할 때) */
  json(): Record<string, unknown> {
    return JSON.parse(this.text) as Record<string, unknown>;
  }

  get location(): string | null {
    return this.headers.get('location');
  }

  header(name: string): string | null {
    return this.headers.get(name);
  }

  /** 서버가 새로 준 쿠키 (지운 쿠키는 빈 문자열) */
  cookies(): Record<string, string> {
    const found: Record<string, string> = {};
    for (const line of this.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = (pair ?? '').indexOf('=');
      if (at > 0) found[(pair ?? '').slice(0, at)] = decodeURIComponent((pair ?? '').slice(at + 1));
    }
    return found;
  }
}

// API 테스트 도구: 실제 서버(AppModule)를 테스트 안에서 임의 포트로 띄우고 HTTP로 부른다.
// 로그인은 진짜 흐름 그대로 (설치 코드 → 주인 계정, 또는 아이디·비밀번호 로그인).
//
//   const api = await ApiClient.start();
//   const owner = await api.signIn();
//   const res = await api.get('/api/plugins', owner);
//   assert.equal(res.status, 200);
//   await api.close();
export class ApiClient {
  /** 테스트용 주인 계정 */
  static readonly OWNER_LOGIN = 'owner';
  static readonly OWNER_PASSWORD = 'test-password-123';

  private constructor(
    private readonly app: INestApplication,
    readonly baseUrl: string,
  ) {}

  static async start(): Promise<ApiClient> {
    process.env.CAIRN_SECRET_KEY ??= SecretBox.newKey();
    const app = await NestFactory.create(AppModule, { logger: false });
    HttpSetup.apply(app);
    await app.listen(0, '127.0.0.1');
    return new ApiClient(app, await app.getUrl());
  }

  /** 서버 안의 객체를 꺼낸다 */
  service<T>(type: new (...args: never[]) => T): T {
    return this.app.get(type);
  }

  installCode(): string {
    return this.service(InstallPolicy).code();
  }

  /** headers: 브라우저가 붙이는 머리글을 흉내 낼 때 (Origin, Sec-Fetch-Site 등) */
  request(
    method: string,
    path: string,
    as: TestUser = TestUser.visitor,
    body?: object,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<ApiResult> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(as.header ? { cookie: as.header } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (res) => new ApiResult(res.status, await res.text(), res.headers));
  }

  get(path: string, as: TestUser = TestUser.visitor): Promise<ApiResult> {
    return this.request('GET', path, as);
  }

  /** form으로 보내기 (OAuth 토큰 요청처럼 application/x-www-form-urlencoded) */
  form(path: string, values: Readonly<Record<string, string>>): Promise<ApiResult> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString(),
    }).then(async (res) => new ApiResult(res.status, await res.text(), res.headers));
  }

  /** MCP 요청 하나 (JSON-RPC). token: 기기의 Bearer 토큰 */
  mcp(token: string | null, method: string, params: object = {}): Promise<ApiResult> {
    return fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }).then(async (res) => new ApiResult(res.status, await res.text(), res.headers));
  }

  /** 설치 코드를 넣는다. 돌려준 사람은 설치 통행증을 가진 브라우저 */
  async beginInstall(): Promise<TestUser> {
    const verified = await this.request('POST', '/api/install/verify', TestUser.visitor, {
      code: this.installCode(),
    });
    if (verified.status !== 200) throw new Error(`설치 코드 확인 실패: ${verified.text}`);
    return new TestUser(verified.cookies());
  }

  /** 아이디·비밀번호 로그인 (응답 그대로) */
  async login(login: string, password: string): Promise<ApiResult> {
    return this.request('POST', '/api/auth/login', TestUser.visitor, { login, password });
  }

  /** 주인으로 로그인한 사람. 아직 설치 전이면 설치(주인 계정 만들기)부터 한다 */
  async signIn(): Promise<TestUser> {
    const status = (await this.get('/api/install')).json();
    const done = status.installed
      ? await this.login(ApiClient.OWNER_LOGIN, ApiClient.OWNER_PASSWORD)
      : await this.request('POST', '/api/install/owner', await this.beginInstall(), {
          login: ApiClient.OWNER_LOGIN,
          password: ApiClient.OWNER_PASSWORD,
        });
    const session = done.cookies().cairn_session;
    if (done.status !== 200 || !session)
      throw new Error(`로그인 실패: ${done.status} ${done.text}`);
    return new TestUser({ cairn_session: session });
  }

  /**
   * 기기를 연결하고 access 토큰을 돌려준다. AI 도구가 하는 순서 그대로:
   * 스스로 등록 → 승인 요청 → 주인이 승인 화면에서 연결 → 코드를 토큰으로 (PKCE).
   * 사이트 주소(블로그 정보)가 정해져 있어야 한다.
   */
  async connectDevice(owner: TestUser, name: string): Promise<string> {
    const redirect = 'http://localhost:33418/callback';
    const registered = await this.request('POST', '/oauth/register', TestUser.visitor, {
      client_name: 'Claude Code',
      redirect_uris: [redirect],
    });
    const clientId = String(registered.json().client_id);
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'test',
    });
    const begin = await this.get(`/oauth/authorize?${query}`);
    const request = new URL(begin.location ?? 'http://x').searchParams.get('request') ?? '';
    const approved = await this.request('POST', '/api/connect/approve', owner, { request, name });
    if (approved.status !== 200) throw new Error(`기기 승인 실패: ${approved.text}`);
    const code = new URL(String(approved.json().redirect)).searchParams.get('code') ?? '';
    const token = await this.form('/oauth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
    });
    if (token.status !== 200) throw new Error(`토큰 받기 실패: ${token.text}`);
    return String(token.json().access_token);
  }

  async close(): Promise<void> {
    await this.app.close();
  }
}
