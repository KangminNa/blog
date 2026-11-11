// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** vault.attachments */
export interface AttachmentRow {
  revision_id: string;
  blob_hash: string;
  name: string | null;
  caption: string | null;
  position: number;
  visibility: string;
  scan_status: string;
  scan_flags: unknown | null;
}
export type AttachmentNew = Partial<AttachmentRow> & Pick<AttachmentRow, 'revision_id' | 'blob_hash'>;

/** vault.categories */
export interface CategoryRow {
  node_id: string;
  space_id: string;
  name: string;
  slug: string;
  color: string | null;
  description: string | null;
  origin: string;
  pinned: boolean;
  version: number;
  meta: unknown;
  sort: number;
}
export type CategoryNew = Partial<CategoryRow> & Pick<CategoryRow, 'node_id' | 'space_id' | 'name' | 'slug' | 'origin'>;

/** vault.change_ops */
export interface ChangeOpRow {
  change_set_id: string;
  seq: number;
  op: string;
  target_kind: string;
  target_id: string | null;
  base_version: number | null;
  payload: unknown;
  verdict: string | null;
  rule: string | null;
  status: string;
  reason: string | null;
  decided_at: Date | null;
  decided_by: string | null;
}
export type ChangeOpNew = Partial<ChangeOpRow> & Pick<ChangeOpRow, 'change_set_id' | 'seq' | 'op' | 'target_kind' | 'status'>;

/** vault.change_sets */
export interface ChangeSetRow {
  id: string;
  space_id: string;
  kind: string;
  status: string;
  actor_type: string;
  actor_id: string | null;
  job_id: string | null;
  message: string;
  base_graph_version: number | null;
  op_count: number;
  reverted_by: string | null;
  version: number;
  created_at: Date;
  submitted_at: Date | null;
  closed_at: Date | null;
}
export type ChangeSetNew = Partial<ChangeSetRow> & Pick<ChangeSetRow, 'id' | 'space_id' | 'kind' | 'status' | 'actor_type'>;

/** vault.changes */
export interface ChangeRow {
  created_at: Date;
  id: number;
  space_id: string;
  batch_id: string;
  actor_type: string;
  actor_id: string | null;
  domain: string;
  entity: string;
  entity_id: string;
  op: string;
  before: unknown | null;
  after: unknown | null;
  undone_by: string | null;
}
export type ChangeNew = Partial<ChangeRow> & Pick<ChangeRow, 'id' | 'space_id' | 'batch_id' | 'actor_type' | 'domain' | 'entity' | 'entity_id' | 'op'>;

/** vault.chunk_embeddings */
export interface ChunkEmbeddingRow {
  chunk_id: string;
  model_id: number;
  embedding: string;
}
export type ChunkEmbeddingNew = Partial<ChunkEmbeddingRow> & Pick<ChunkEmbeddingRow, 'chunk_id' | 'model_id' | 'embedding'>;

/** vault.chunks */
export interface ChunkRow {
  id: string;
  space_id: string;
  session_id: string;
  revision_id: string;
  section: string;
  chunk_no: number;
  text: string;
}
export type ChunkNew = Partial<ChunkRow> & Pick<ChunkRow, 'id' | 'space_id' | 'session_id' | 'revision_id' | 'section' | 'chunk_no' | 'text'>;

/** vault.edge_kinds */
export interface EdgeKindRow {
  name: string;
  directed: boolean;
  ai_creatable: boolean;
  description: string | null;
}
export type EdgeKindNew = Partial<EdgeKindRow> & Pick<EdgeKindRow, 'name' | 'directed' | 'ai_creatable'>;

/** vault.edges */
export interface EdgeRow {
  id: string;
  space_id: string;
  src: string;
  dst: string;
  kind: string;
  weight: number | null;
  origin: string;
  pinned: boolean;
  version: number;
  actor_type: string | null;
  actor_id: string | null;
  created_at: Date;
  deleted_at: Date | null;
  deleted_by_type: string | null;
}
export type EdgeNew = Partial<EdgeRow> & Pick<EdgeRow, 'id' | 'space_id' | 'src' | 'dst' | 'kind' | 'origin'>;

/** vault.edit_leases */
export interface EditLeasRow {
  target_kind: string;
  target_id: string;
  space_id: string;
  holder: string;
  base_revision_id: string | null;
  base_version: number | null;
  expires_at: Date;
  created_at: Date;
}
export type EditLeasNew = Partial<EditLeasRow> & Pick<EditLeasRow, 'target_kind' | 'target_id' | 'space_id' | 'holder' | 'expires_at'>;

/** vault.graph_snapshots */
export interface GraphSnapshotRow {
  id: number;
  space_id: string;
  view_id: string | null;
  audience: string;
  version: number;
  blob_hash: string | null;
  node_count: number;
  edge_count: number;
  built_at: Date;
}
export type GraphSnapshotNew = Partial<GraphSnapshotRow> & Pick<GraphSnapshotRow, 'id' | 'space_id' | 'audience' | 'version'>;

/** vault.graph_views */
export interface GraphViewRow {
  id: string;
  space_id: string;
  name: string;
  audience: string;
  version: number;
  built_at: Date | null;
  settings: unknown;
  is_default: boolean;
  updated_at: Date;
}
export type GraphViewNew = Partial<GraphViewRow> & Pick<GraphViewRow, 'id' | 'space_id' | 'name' | 'audience'>;

/** vault.node_kinds */
export interface NodeKindRow {
  name: string;
  detail_table: string;
  description: string | null;
}
export type NodeKindNew = Partial<NodeKindRow> & Pick<NodeKindRow, 'name' | 'detail_table'>;

/** vault.node_layout */
export interface NodeLayoutRow {
  view_id: string;
  node_id: string;
  x: number;
  y: number;
  pinned: boolean;
}
export type NodeLayoutNew = Partial<NodeLayoutRow> & Pick<NodeLayoutRow, 'view_id' | 'node_id' | 'x' | 'y'>;

/** vault.nodes */
export interface NodeRow {
  id: string;
  space_id: string;
  kind: string;
  created_at: Date;
  deleted_at: Date | null;
  purge_after: Date | null;
}
export type NodeNew = Partial<NodeRow> & Pick<NodeRow, 'id' | 'space_id' | 'kind'>;

/** vault.post_marks */
export interface PostMarkRow {
  post_id: string;
  space_id: string;
  title: string;
  slug: string;
  status: string;
  main_wiki_id: string | null;
  ref_wiki_ids: readonly string[];
  post_version: number;
  updated_at: Date;
}
export type PostMarkNew = Partial<PostMarkRow> & Pick<PostMarkRow, 'post_id' | 'space_id' | 'title' | 'slug' | 'status' | 'post_version'>;

/** vault.project_rules */
export interface ProjectRuleRow {
  space_id: string;
  project: string;
  default_visibility: string;
  collect: boolean;
  updated_at: Date;
}
export type ProjectRuleNew = Partial<ProjectRuleRow> & Pick<ProjectRuleRow, 'space_id' | 'project'>;

/** vault.review_rules */
export interface ReviewRuleRow {
  space_id: string;
  key: string;
  action: string;
  value: number | null;
  updated_at: Date;
  updated_by: string | null;
}
export type ReviewRuleNew = Partial<ReviewRuleRow> & Pick<ReviewRuleRow, 'space_id' | 'key' | 'action'>;

/** vault.session_revisions */
export interface SessionRevisionRow {
  id: string;
  session_id: string;
  seq: number;
  kind: string;
  parent_ids: readonly string[];
  base_revision_id: string | null;
  body_md: string;
  sections: unknown;
  sections_schema: number;
  section_hashes: unknown;
  content_hash: string;
  redactions: unknown | null;
  actor_type: string;
  actor_id: string | null;
  created_at: Date;
}
export type SessionRevisionNew = Partial<SessionRevisionRow> & Pick<SessionRevisionRow, 'id' | 'session_id' | 'seq' | 'kind' | 'body_md' | 'sections' | 'section_hashes' | 'content_hash' | 'actor_type'>;

/** vault.sessions */
export interface SessionRow {
  node_id: string;
  space_id: string;
  device_id: string;
  tool: string;
  source_session_id: string;
  project: string | null;
  visibility: string;
  head_revision_id: string | null;
  held_revision_id: string | null;
  version: number;
  pinned_sections: readonly string[];
  head_title: string | null;
  head_summary: string | null;
  head_text: string | null;
  revision_count: number;
  started_at: Date | null;
  last_revision_at: Date | null;
  meta: unknown;
  wiki_id: string | null;
  tidy_requested_seq: number;
}
export type SessionNew = Partial<SessionRow> & Pick<SessionRow, 'node_id' | 'space_id' | 'device_id' | 'tool' | 'source_session_id'>;

/** vault.stale_wikis */
export interface StaleWikiRow {
  wiki_id: string;
  space_id: string;
  score: number;
  noticed_at: Date;
}
export type StaleWikiNew = Partial<StaleWikiRow> & Pick<StaleWikiRow, 'wiki_id' | 'space_id' | 'score'>;

/** vault.tidy_settings */
export interface TidySettingRow {
  space_id: string;
  auto_tidy: boolean;
  version: number;
  updated_at: Date;
}
export type TidySettingNew = Partial<TidySettingRow> & Pick<TidySettingRow, 'space_id'>;

/** vault.wiki_aliases */
export interface WikiAliasRow {
  old_id: string;
  space_id: string;
  new_id: string;
  change_set_id: string | null;
  created_at: Date;
}
export type WikiAliasNew = Partial<WikiAliasRow> & Pick<WikiAliasRow, 'old_id' | 'space_id' | 'new_id'>;

/** vault.wiki_revisions */
export interface WikiRevisionRow {
  id: string;
  wiki_id: string;
  seq: number;
  kind: string;
  base_revision_id: string | null;
  change_set_id: string | null;
  body_md: string;
  sections: unknown;
  section_hashes: unknown;
  content_hash: string;
  actor_type: string;
  actor_id: string | null;
  created_at: Date;
}
export type WikiRevisionNew = Partial<WikiRevisionRow> & Pick<WikiRevisionRow, 'id' | 'wiki_id' | 'seq' | 'kind' | 'body_md' | 'sections' | 'section_hashes' | 'content_hash' | 'actor_type'>;

/** vault.wikis */
export interface WikiRow {
  node_id: string;
  space_id: string;
  category_id: string | null;
  title: string;
  slug: string;
  visibility: string;
  origin: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  meta: unknown;
  head_revision_id: string | null;
  pinned_sections: readonly string[];
  head_text: string | null;
  revision_count: number;
}
export type WikiNew = Partial<WikiRow> & Pick<WikiRow, 'node_id' | 'space_id' | 'title' | 'slug' | 'origin'>;
