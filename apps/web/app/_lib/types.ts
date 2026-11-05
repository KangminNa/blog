// 손으로 적은 서버 응답 모양 (옮기는 중). 새 타입은 서버 view에서 import type으로 _<모듈>/types.ts에 만든다.
// 여기 남은 이름은 scripts/check-structure.mjs의 HAND_WRITTEN_TYPES에 있고, 메뉴를 옮기면 함께 지운다.

/** 서버의 오류 모양: { code, message, fields? } */
export type ApiError = { code: string; message: string; fields?: Record<string, string> };

/** 기기 권한의 화면 이름 */
export const SCOPE_LABELS: Record<string, string> = {
  upload: '세션 저장',
  read_public: '공개 읽기',
  read_all: '전체 읽기',
  tidy: '정리',
  write: '초안 작성',
  run: '작업 실행',
};
