// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** mcp.mcp_reads */
export interface McpReadRow {
  created_at: Date;
  id: number;
  space_id: string;
  device_id: string | null;
  tool: string;
  query: unknown;
  result_count: number | null;
}
export type McpReadNew = Partial<McpReadRow> & Pick<McpReadRow, 'id' | 'space_id' | 'tool'>;
