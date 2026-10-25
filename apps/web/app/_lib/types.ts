// 서버 API가 돌려주는 모양 (apps/server의 *.response.ts와 맞춘다)

export type InstallStatus = {
  installed: boolean;
  step: 'code' | 'owner' | 'done';
};

export type SpaceInfo = {
  name: string;
  description: string;
  siteUrl: string | null;
  installed: boolean;
  version: number;
  /** ChatGPT·Claude 앱(회사 서버에서 들어오는 연결)을 받는가 */
  hostedApps: boolean;
};

export type Owner = { login: string };

/** 로그인 화면의 버튼 (켜진 로그인 플러그인) */
export type LoginMethod = { method: string; label: string };

/** 주인에게 연결된 외부 계정 */
export type LoginLink = { method: string; label: string; linkedAt: string };

export type PluginSetting = {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'select' | 'boolean';
  required: boolean;
  help: string | null;
  options: string[];
  value: string | null;
  isSet: boolean;
};

export type Plugin = {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  active: boolean;
  uses: string[];
  useLabels: string[];
  needsGrant: string[];
  missing: string[];
  settings: PluginSetting[];
  actions: { name: string; label: string }[];
};

export type ActionResult = { ok: boolean; message: string; details: string[] };

/** 서버의 오류 모양: { code, message, fields? } */
export type ApiError = { code: string; message: string; fields?: Record<string, string> };

/** 기기 하나 (관리 화면의 기기 시트) */
export type Device = {
  id: string;
  name: string;
  client: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  version: number;
};

/** 승인 화면에 보일 것 */
export type Consent = {
  clientName: string;
  redirectHost: string;
  name: string;
  scopes: string[];
  /** 돌아갈 곳이 ChatGPT·Claude 앱이면 그 이름 (이 컴퓨터의 도구면 null) */
  app: string | null;
};

/** 기기 권한의 화면 이름 */
export const SCOPE_LABELS: Record<string, string> = {
  upload: '세션 올리기',
  read_public: '공개된 것 읽기',
  read_all: '비공개까지 읽기',
  tidy: '정리하기',
  write: '글 초안 쓰기',
};

/** 세션 목록의 한 줄 (관리 화면의 세션 시트). 기기는 id만: 이름은 기기 목록과 맞춘다 */
export type SessionSummary = {
  id: string;
  title: string;
  project: string | null;
  tool: string;
  deviceId: string;
  visibility: 'private' | 'public';
  revisionCount: number;
  startedAt: string | null;
  lastRevisionAt: string | null;
};

/** 목록 한 쪽. next가 있으면 ?cursor=next로 다음 쪽 */
export type SessionPage = { sessions: SessionSummary[]; next: string | null };

/** 서버가 지운 민감정보 (값은 없이 칸과 종류만) */
export type Redaction = { kind: 'secret'; section: string; label: string };

/** 판 하나의 내용 */
export type SessionRevision = {
  seq: number;
  kind: 'origin' | 'human' | 'merge';
  actorType: string;
  createdAt: string;
  title: string;
  tags: string[];
  sections: { name: string; heading: string; text: string }[];
  warnings: Redaction[];
  markdown: string;
};

/** 세션 하나: 지금 판 + 판 기록 */
export type SessionDetail = SessionSummary & {
  sourceSessionId: string;
  head: SessionRevision;
  history: {
    seq: number;
    kind: string;
    actorType: string;
    createdAt: string;
    redactions: number;
  }[];
};

/** 글의 공개 범위: 임시(나만) · 공개(목록에 보임) · 링크만(주소로만) */
export type PostStatus = 'draft' | 'published' | 'unlisted';

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: '임시',
  published: '공개',
  unlisted: '링크만',
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
  /** 목록에 보이는 글인가 (링크만·임시 글이면 false) */
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
