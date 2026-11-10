// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** code_github.pulls */
export interface PullRow {
  id: string;
  space_id: string;
  repo_id: string;
  task_id: string;
  branch: string;
  number: number;
  url: string;
  head_sha: string;
  checks: unknown;
  status: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}
export type PullNew = Partial<PullRow> & Pick<PullRow, 'id' | 'space_id' | 'repo_id' | 'task_id' | 'branch' | 'number' | 'url' | 'head_sha'>;

/** code_github.repos */
export interface RepoRow {
  id: string;
  space_id: string;
  name: string;
  url: string;
  base: string;
  setup: string;
  checks: readonly string[];
  version: number;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}
export type RepoNew = Partial<RepoRow> & Pick<RepoRow, 'id' | 'space_id' | 'name' | 'url' | 'base'>;
