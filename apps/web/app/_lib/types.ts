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
export type Consent = { clientName: string; redirectHost: string; name: string; scopes: string[] };

/** 기기 권한의 화면 이름 */
export const SCOPE_LABELS: Record<string, string> = {
  upload: '세션 올리기',
  read_public: '공개된 것 읽기',
  read_all: '비공개까지 읽기',
  tidy: '정리하기',
  write: '글 초안 쓰기',
};
