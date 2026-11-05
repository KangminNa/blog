// 손으로 적은 서버 응답 모양 (옮기는 중). 새 타입은 서버 view에서 import type으로 _<모듈>/types.ts에 만든다.
// 여기 남은 이름은 scripts/check-structure.mjs의 HAND_WRITTEN_TYPES에 있고, 메뉴를 옮기면 함께 지운다.

export type Owner = { login: string };

/** 로그인 화면의 버튼 (켜진 로그인 플러그인) */
export type LoginMethod = { method: string; label: string };

/** 주인에게 연결된 외부 계정 */
export type LoginLink = { method: string; label: string; linkedAt: string };

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

/** 글의 공개 범위: 초안(나만) · 공개(목록에 보임) · 링크 공개(주소로만) */
export type PostStatus = 'draft' | 'published' | 'unlisted';

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: '초안',
  published: '공개',
  unlisted: '링크 공개',
};

/** 글 목록의 한 줄 (방문자가 보는 것) */
export type PostSummary = {
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  publishedAt: string | null;
};

/** 관리 화면 글 목록의 한 줄 */
export type AdminPostSummary = PostSummary & {
  id: string;
  status: PostStatus;
  revisionCount: number;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
};

export type PostCounts = { draft: number; published: number; unlisted: number; trash: number };

/** 목록 한 쪽. counts는 주인에게만 */
export type PostList<T extends PostSummary = PostSummary> = {
  posts: T[];
  next: string | null;
  counts?: PostCounts;
};

/** 글 페이지 (주인이 보면 status·version까지) */
export type PostPage = PostSummary & {
  body: string;
  align: 'left' | 'center';
  /** 목록에 보이는 글인가 (링크 공개·초안이면 false) */
  listed: boolean;
  status?: PostStatus;
};

/** 편집기가 다루는 글 (쓰기 결과도 같은 모양. revised: 이번 저장으로 새 판이 생겼나) */
export type EditablePost = {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  align: 'left' | 'center';
  status: PostStatus;
  version: number;
  revisionCount: number;
  publishedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  revised?: boolean;
};
