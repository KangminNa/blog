import type { RequestFields } from '../platform';

/** 없거나 null이면 fallback, 있으면 범위 안의 정수 (RequestFields.integer는 필수 칸만 읽는다) */
export function integerOr<T>(
  f: RequestFields,
  raw: unknown,
  name: string,
  min: number,
  max: number,
  fallback: T,
): number | T {
  const value = (raw as Record<string, unknown> | null | undefined)?.[name];
  return value === undefined || value === null ? fallback : f.integer(name, min, max);
}
