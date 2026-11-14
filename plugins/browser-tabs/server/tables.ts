// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** browser_tabs.clicks */
export interface ClickRow {
  id: string;
  space_id: string;
  task_id: string;
  site_id: string;
  runner_id: string;
  tab_id: string;
  page_url: string;
  page_title: string;
  role: string;
  name: string;
  nth: number;
  box: unknown;
  fingerprint: string;
  note: string | null;
  status: string;
  approval_id: string | null;
  reason: string | null;
  after_url: string | null;
  created_at: Date;
  decided_at: Date | null;
  clicked_at: Date | null;
  version: number;
}
export type ClickNew = Partial<ClickRow> & Pick<ClickRow, 'id' | 'space_id' | 'task_id' | 'site_id' | 'runner_id' | 'tab_id' | 'page_url' | 'role' | 'name' | 'box' | 'fingerprint'>;

/** browser_tabs.reads */
export interface ReadRow {
  id: string;
  space_id: string;
  url: string;
  status: string;
  title: string | null;
  body: string | null;
  error: string | null;
  requested_at: Date;
  read_at: Date | null;
  version: number;
}
export type ReadNew = Partial<ReadRow> & Pick<ReadRow, 'id' | 'space_id' | 'url'>;

/** browser_tabs.shots */
export interface ShotRow {
  id: string;
  space_id: string;
  task_id: string;
  click_id: string | null;
  kind: string;
  seq: number;
  url: string;
  title: string;
  image: Buffer;
  mime: string;
  created_at: Date;
}
export type ShotNew = Partial<ShotRow> & Pick<ShotRow, 'id' | 'space_id' | 'task_id' | 'kind' | 'seq' | 'image' | 'mime'>;

/** browser_tabs.sites */
export interface SiteRow {
  id: string;
  space_id: string;
  name: string;
  start_url: string;
  origins: readonly string[];
  created_at: Date;
  updated_at: Date;
  version: number;
  login_needed_at: Date | null;
}
export type SiteNew = Partial<SiteRow> & Pick<SiteRow, 'id' | 'space_id' | 'name' | 'start_url' | 'origins'>;
