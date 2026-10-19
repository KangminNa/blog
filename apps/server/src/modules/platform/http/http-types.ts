// Express 요청·응답 중 Controller·Guard가 쓰는 부분. 외부(Express) 객체의 모양을 가리키는 타입이라
// 여기 한 곳에만 두고, 진입 계층은 이것만 쓴다.

/** 들어온 HTTP 요청 */
export type HttpRequest = {
  method: string;
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
  ip?: string;
  protocol: string;
  actor?: unknown;
};

/** 나가는 HTTP 응답 (쿠키, 다른 주소로 보내기) */
export type HttpResponse = {
  cookie(name: string, value: string, options: object): void;
  clearCookie(name: string, options: object): void;
  redirect(status: number, url: string): void;
};
