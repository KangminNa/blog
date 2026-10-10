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
