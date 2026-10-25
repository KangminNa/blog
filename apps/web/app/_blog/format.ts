// 블로그 화면의 날짜. 시간대는 우선 한국 시간으로 둔다 (블로그 설정이 생기면 그리로 옮긴다).
const DATE = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Seoul',
});

export function formatDate(iso: string | null): string {
  return iso ? DATE.format(new Date(iso)) : '';
}

/** 주소의 글 이름(slug). 한글 주소는 인코딩된 채로 올 수 있다 */
export function slugFrom(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function postPath(slug: string): string {
  return `/posts/${encodeURIComponent(slug)}`;
}
