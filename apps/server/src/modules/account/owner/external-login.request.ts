import { BaseRequest, type SecretBox } from '../../platform';

/**
 * 외부 로그인(로그인 플러그인) 시작: ?return=/install. 로그인 뒤 돌아갈 곳은 이 사이트 안의 경로만.
 *   login: 연결해 둔 외부 계정으로 주인 로그인
 *   link:  로그인한 주인이 외부 계정을 연결
 */
export class ExternalStartRequest extends BaseRequest {
  static readonly LOGIN = 'login';
  static readonly LINK = 'link';

  private constructor(
    readonly method: string,
    readonly mode: string,
    readonly returnTo: string,
  ) {
    super();
  }

  static from(method: string, mode: string, query: unknown): ExternalStartRequest {
    return BaseRequest.read(query, (f) => {
      const returnTo = f.optionalText('return', 300) ?? '/';
      if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('\\'))
        f.reject('return', '이 사이트 안의 경로(/로 시작)여야 해요');
      return new ExternalStartRequest(method, mode, returnTo);
    });
  }
}

/**
 * 외부 서비스가 돌려보낸 요청. 쿼리의 state가 로그인을 시작한 브라우저의 쿠키(서명한 값)와 맞아야 한다.
 * 쿠키에는 "확인값|방식|돌아갈 곳|연결하는 주인"이 들어 있다. 다른 사람이 만든 링크로는 로그인·연결되지 않는다.
 */
export class ExternalCallbackRequest extends BaseRequest {
  static readonly COOKIE = 'cairn_login';
  static readonly SECONDS = 600;

  private constructor(
    readonly method: string,
    readonly query: ReadonlyMap<string, string>,
    readonly mode: string,
    readonly returnTo: string,
    readonly userId: string | null,
  ) {
    super();
  }

  /** 시작할 때 브라우저에 줄 쿠키 값 */
  static cookieFor(
    box: SecretBox,
    state: string,
    start: ExternalStartRequest,
    userId: string | null,
  ): string {
    return box.sign(
      [state, start.mode, start.returnTo, userId ?? ''].join('|'),
      ExternalCallbackRequest.SECONDS,
    );
  }

  static from(
    method: string,
    query: Readonly<Record<string, unknown>>,
    cookie: string | null,
    box: SecretBox,
  ): ExternalCallbackRequest {
    return BaseRequest.read(query, (f) => {
      const state = f.text('state', 200);
      const [expected, mode, returnTo, userId] = (box.verify(cookie) ?? '').split('|');
      if (!expected || expected !== state)
        f.reject('state', '로그인을 시작한 브라우저가 아니거나 10분이 지났어요. 다시 해 주세요');
      const values = new Map<string, string>();
      for (const [key, value] of Object.entries(query))
        if (typeof value === 'string') values.set(key, value);
      return new ExternalCallbackRequest(
        method,
        values,
        mode === ExternalStartRequest.LINK ? ExternalStartRequest.LINK : ExternalStartRequest.LOGIN,
        returnTo || '/',
        userId || null,
      );
    });
  }

  get isLink(): boolean {
    return this.mode === ExternalStartRequest.LINK;
  }
}
