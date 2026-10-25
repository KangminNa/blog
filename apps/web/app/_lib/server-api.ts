import { cookies } from 'next/headers';

// 서버 컴포넌트에서 서버 API 부르기. 브라우저의 쿠키(로그인·설치 통행증)를 그대로 넘겨 같은 사람으로 묻는다.
// 웹은 DB에 직접 닿지 않는다 (AGENTS.md 코드 규칙).
const BASE = process.env.API_URL ?? 'http://localhost:4000';

/** 응답 하나: 상태 코드와 본문 (연결 실패면 status 0) */
export type ServerReply<T> = { status: number; data: T | null };

/** asVisitor: 쿠키를 넘기지 않고 방문자로 묻는다 (방문자 화면은 주인이 열어도 방문자가 보는 그대로) */
export async function serverFetch<T>(path: string, asVisitor = false): Promise<ServerReply<T>> {
  const jar = await cookies();
  const cookie = asVisitor
    ? ''
    : jar
        .getAll()
        .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
        .join('; ');
  try {
    const res = await fetch(`${BASE}${path}`, {
      cache: 'no-store',
      headers: cookie ? { cookie } : {},
    });
    return { status: res.status, data: (await res.json().catch(() => null)) as T | null };
  } catch {
    return { status: 0, data: null };
  }
}

/** 성공하면 본문, 실패(401·404 등)나 연결 실패면 null */
export async function serverGet<T>(path: string, asVisitor = false): Promise<T | null> {
  const reply = await serverFetch<T>(path, asVisitor);
  return reply.status >= 200 && reply.status < 300 ? reply.data : null;
}
