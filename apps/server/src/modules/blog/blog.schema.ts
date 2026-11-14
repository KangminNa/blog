// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

/** blog.page_revisions */
export const pageRevisions = blogSchema.table('page_revisions', {
  id: uuid('id').notNull(),
  page_id: uuid('page_id').notNull(),
  seq: integer('seq').notNull(),
  files: jsonb('files').notNull(),
  task_id: uuid('task_id').notNull(),
  run_id: uuid('run_id').notNull(),
  note: text('note').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** blog.pages */
export const pages = blogSchema.table('pages', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  name: text('name').notNull(),
  title: text('title').notNull(),
  visibility: text('visibility').notNull(),
  current_seq: integer('current_seq').notNull(),
  revisions: integer('revisions').notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** blog.post_revisions */
export const postRevisions = blogSchema.table('post_revisions', {
  id: uuid('id').notNull(),
  post_id: uuid('post_id').notNull(),
  seq: integer('seq').notNull(),
  body_md: text('body_md').notNull(),
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
