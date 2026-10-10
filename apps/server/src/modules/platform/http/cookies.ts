import type { HttpRequest, HttpResponse } from './http-types';

// 쿠키 읽기·쓰기. 라이브러리 없이: 읽기는 Cookie 머리글을 나누고, 쓰기는 Express의 res.cookie를 쓴다.
// 로그인·설치 통행증처럼 서버만 읽는 값이라 모두 httpOnly, SameSite=Lax. https로 들어온 요청이면 Secure.
// biome-ignore lint/complexity/noStaticOnlyClass: 진입 계층(Controller·Guard)이 함께 쓰는 쿠키 규칙 한 곳
export class Cookies {
  static read(request: Pick<HttpRequest, 'headers'>, name: string): string | null {
    const header = request.headers.cookie;
    if (typeof header !== 'string') return null;
    for (const part of header.split(';')) {
      const at = part.indexOf('=');
      if (at < 0) continue;
      if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
    }
    return null;
  }

  static set(
    response: HttpResponse,
    request: HttpRequest,
    name: string,
    value: string,
    maxAgeSeconds: number,
  ): void {
    response.cookie(name, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.protocol === 'https',
      path: '/',
      maxAge: maxAgeSeconds * 1000,
    });
  }

  static clear(response: HttpResponse, name: string): void {
    response.clearCookie(name, { path: '/' });
  }
}
