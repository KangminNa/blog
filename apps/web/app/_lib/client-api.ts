import type { ApiError } from './types';

// 브라우저에서 서버 API 부르기. 같은 주소(/api/…)라 쿠키가 함께 간다.
export type ApiReply<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

export async function api<T>(method: string, path: string, body?: object): Promise<ApiReply<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T & ApiError;
    if (res.ok) return { ok: true, data: json };
    return {
      ok: false,
      status: res.status,
      error: {
        code: json.code ?? 'error',
        message: json.message ?? `오류 ${res.status}`,
        fields: json.fields,
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'network', message: '서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요' },
    };
  }
}

/** 오류를 사람이 읽는 한 줄로 (필드 오류는 필드별로) */
export function describe(error: ApiError): string {
  if (!error.fields) return error.message;
  return Object.values(error.fields).join(' · ');
}
