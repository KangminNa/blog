// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 쿼리 템플릿(QueryTemplate)이 읽기 모양을 만들 때 쓰는 Drizzle 표. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { customType, integer, jsonb, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const vectorColumn = customType<{ data: string }>({ dataType: () => 'vector' });
const blogSchema = pgSchema('blog');
const workSchema = pgSchema('work');

/** blog.assets */
export const assets = blogSchema.table('assets', {
  post_id: uuid('post_id').notNull(),
  blob_hash: text('blob_hash').notNull(),
  alt: text('alt'),
  caption: text('caption'),
});

/** blog.categories */
export const categories = blogSchema.table('categories', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  parent_id: uuid('parent_id'),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  sort: integer('sort').notNull(),
  version: integer('version').notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});

/** blog.chunk_embeddings */
export const chunkEmbeddings = blogSchema.table('chunk_embeddings', {
  chunk_id: uuid('chunk_id').notNull(),
  model_id: smallint('model_id').notNull(),
  embedding: vectorColumn('embedding').notNull(),
});

/** blog.chunks */
export const chunks = blogSchema.table('chunks', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  post_id: uuid('post_id').notNull(),
  revision_id: uuid('revision_id').notNull(),
  chunk_no: integer('chunk_no').notNull(),
  text: text('text').notNull(),
});

/** blog.edit_leases */
export const editLeases = blogSchema.table('edit_leases', {
  target_kind: text('target_kind').notNull(),
  target_id: uuid('target_id').notNull(),
  space_id: uuid('space_id').notNull(),
  holder: text('holder').notNull(),
  base_revision_id: uuid('base_revision_id'),
  base_version: integer('base_version'),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** blog.post_revisions */
export const postRevisions = blogSchema.table('post_revisions', {
  id: uuid('id').notNull(),
  post_id: uuid('post_id').notNull(),
  seq: integer('seq').notNull(),
  body_md: text('body_md').notNull(),
  blocks: jsonb('blocks'),
  base_revision_id: uuid('base_revision_id'),
  request_id: text('request_id'),
  actor_type: text('actor_type').notNull(),
  actor_id: uuid('actor_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  title: text('title').notNull(),
});

/** blog.post_wiki_refs */
export const postWikiRefs = blogSchema.table('post_wiki_refs', {
  post_id: uuid('post_id').notNull(),
  wiki_id: uuid('wiki_id').notNull(),
  added_at: timestamp('added_at', { withTimezone: true }).notNull(),
});

/** blog.posts */
export const posts = blogSchema.table('posts', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  slug: text('slug').notNull(),
  lang: text('lang').notNull(),
  status: text('status').notNull(),
  title: text('title'),
  excerpt: text('excerpt'),
  head_text: text('head_text'),
  head_revision_id: uuid('head_revision_id'),
  version: integer('version').notNull(),
  category_id: uuid('category_id'),
  series_id: uuid('series_id'),
  series_order: integer('series_order'),
  tags: text('tags').array().notNull(),
  cover_blob_hash: text('cover_blob_hash'),
  align: text('align').notNull(),
  stone_count: integer('stone_count').notNull(),
  published_at: timestamp('published_at', { withTimezone: true }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  purge_after: timestamp('purge_after', { withTimezone: true }),
  meta: jsonb('meta').notNull(),
  main_wiki_id: uuid('main_wiki_id'),
});

/** blog.series */
export const series = blogSchema.table('series', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** blog.stone_log */
export const stoneLog = blogSchema.table('stone_log', {
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  post_id: uuid('post_id').notNull(),
  visitor_hash: text('visitor_hash').notNull(),
});

/** work.basket_items */
export const basketItems = workSchema.table('basket_items', {
  id: uuid('id').notNull(),
  basket_id: uuid('basket_id').notNull(),
  kind: text('kind').notNull(),
  ref_id: uuid('ref_id'),
  blob_hash: text('blob_hash'),
  url: text('url'),
  title: text('title'),
  note: text('note'),
  sort: integer('sort').notNull(),
  actor_type: text('actor_type').notNull(),
  actor_id: uuid('actor_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** work.baskets */
export const baskets = workSchema.table('baskets', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  name: text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  archived_at: timestamp('archived_at', { withTimezone: true }),
});
