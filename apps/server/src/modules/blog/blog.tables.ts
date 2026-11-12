// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** blog.assets */
export interface AssetRow {
  post_id: string;
  blob_hash: string;
  alt: string | null;
  caption: string | null;
}
export type AssetNew = Partial<AssetRow> & Pick<AssetRow, 'post_id' | 'blob_hash'>;

/** blog.categories */
export interface CategoryRow {
  id: string;
  space_id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  sort: number;
  version: number;
  deleted_at: Date | null;
}
export type CategoryNew = Partial<CategoryRow> & Pick<CategoryRow, 'id' | 'space_id' | 'name' | 'slug'>;

/** blog.chunk_embeddings */
export interface ChunkEmbeddingRow {
  chunk_id: string;
  model_id: number;
  embedding: string;
}
export type ChunkEmbeddingNew = Partial<ChunkEmbeddingRow> & Pick<ChunkEmbeddingRow, 'chunk_id' | 'model_id' | 'embedding'>;

/** blog.chunks */
export interface ChunkRow {
  id: string;
  space_id: string;
  post_id: string;
  revision_id: string;
  chunk_no: number;
  text: string;
}
export type ChunkNew = Partial<ChunkRow> & Pick<ChunkRow, 'id' | 'space_id' | 'post_id' | 'revision_id' | 'chunk_no' | 'text'>;

/** blog.edit_leases */
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

/** blog.page_revisions */
export interface PageRevisionRow {
  id: string;
  page_id: string;
  seq: number;
  files: unknown;
  task_id: string;
  run_id: string;
  note: string;
  created_at: Date;
}
export type PageRevisionNew = Partial<PageRevisionRow> & Pick<PageRevisionRow, 'id' | 'page_id' | 'seq' | 'files' | 'task_id' | 'run_id'>;

/** blog.pages */
export interface PageRow {
  id: string;
  space_id: string;
  name: string;
  title: string;
  visibility: string;
  current_seq: number;
  revisions: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}
export type PageNew = Partial<PageRow> & Pick<PageRow, 'id' | 'space_id' | 'name' | 'title' | 'current_seq' | 'revisions'>;

/** blog.post_revisions */
export interface PostRevisionRow {
  id: string;
  post_id: string;
  seq: number;
  body_md: string;
  blocks: unknown | null;
  base_revision_id: string | null;
  request_id: string | null;
  actor_type: string;
  actor_id: string | null;
  created_at: Date;
  title: string;
}
export type PostRevisionNew = Partial<PostRevisionRow> & Pick<PostRevisionRow, 'id' | 'post_id' | 'seq' | 'body_md' | 'actor_type' | 'title'>;

/** blog.post_wiki_refs */
export interface PostWikiRefRow {
  post_id: string;
  wiki_id: string;
  added_at: Date;
}
export type PostWikiRefNew = Partial<PostWikiRefRow> & Pick<PostWikiRefRow, 'post_id' | 'wiki_id'>;

/** blog.posts */
export interface PostRow {
  id: string;
  space_id: string;
  slug: string;
  lang: string;
  status: string;
  title: string | null;
  excerpt: string | null;
  head_text: string | null;
  head_revision_id: string | null;
  version: number;
  category_id: string | null;
  series_id: string | null;
  series_order: number | null;
  tags: readonly string[];
  cover_blob_hash: string | null;
  align: string;
  stone_count: number;
  published_at: Date | null;
  updated_at: Date;
  deleted_at: Date | null;
  purge_after: Date | null;
  meta: unknown;
  main_wiki_id: string | null;
}
export type PostNew = Partial<PostRow> & Pick<PostRow, 'id' | 'space_id' | 'slug'>;

/** blog.series */
export interface SeriesRow {
  id: string;
  space_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: Date;
}
export type SeriesNew = Partial<SeriesRow> & Pick<SeriesRow, 'id' | 'space_id' | 'name' | 'slug'>;

/** blog.stone_log */
export interface StoneLogRow {
  created_at: Date;
  post_id: string;
  visitor_hash: string;
}
export type StoneLogNew = Partial<StoneLogRow> & Pick<StoneLogRow, 'post_id' | 'visitor_hash'>;

/** work.basket_items */
export interface BasketItemRow {
  id: string;
  basket_id: string;
  kind: string;
  ref_id: string | null;
  blob_hash: string | null;
  url: string | null;
  title: string | null;
  note: string | null;
  sort: number;
  actor_type: string;
  actor_id: string | null;
  created_at: Date;
}
export type BasketItemNew = Partial<BasketItemRow> & Pick<BasketItemRow, 'id' | 'basket_id' | 'kind' | 'actor_type'>;

/** work.baskets */
export interface BasketRow {
  id: string;
  space_id: string;
  name: string;
  created_at: Date;
  archived_at: Date | null;
}
export type BasketNew = Partial<BasketRow> & Pick<BasketRow, 'id' | 'space_id'>;
