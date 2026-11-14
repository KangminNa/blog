// 웹 전체가 함께 쓰는 것. 서버 응답 모양은 여기에 손으로 적지 않고 서버 view에서 import type으로
// app/_<모듈>/types.ts에 만든다 (scripts/check-structure.mjs). 오류 모양만은 모든 실패 응답의 모양이라 여기 둔다.

/** 서버의 오류 모양: { code, message, fields? } */
export type ApiError = { code: string; message: string; fields?: Record<string, string> };

/** 기기 권한의 화면 이름 */
export const SCOPE_LABELS: Record<string, string> = {
  upload: '세션 저장',
  read_public: '공개 읽기',
  read_all: '전체 읽기',
  tidy: '정리',
  write: '초안 작성',
  browse: '브라우저 사용',
  code: '코드 작업',
  make: '파일 만들기',
  run: '작업 실행',
  delegate: '에이전트에게 맡기기',
  sandbox: '코드 러너 칸',
};
