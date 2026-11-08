// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

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
}
export type SiteNew = Partial<SiteRow> &
  Pick<SiteRow, 'id' | 'space_id' | 'name' | 'start_url' | 'origins'>;
