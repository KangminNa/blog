-- migrate:up
-- 블로그 글 (M4 앞당김: 쓰기·고치기·지우기와 글마다 공개 범위, 2026-10-24)
--   posts.status: 임시(draft, 나만) · 공개(published, 목록에 보임) · 링크만(unlisted, 목록·검색에는 안 나오고 주소로만)
--   post_revisions.title: 판마다 제목도 남긴다. posts.title은 지금 판의 찾기용 사본

ALTER TABLE blog.posts DROP CONSTRAINT posts_status_check;
ALTER TABLE blog.posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('draft', 'published', 'unlisted'));

ALTER TABLE blog.post_revisions ADD COLUMN title text NOT NULL DEFAULT '';
ALTER TABLE blog.post_revisions ALTER COLUMN title DROP DEFAULT;

-- migrate:down
ALTER TABLE blog.post_revisions DROP COLUMN title;

UPDATE blog.posts SET status = 'draft' WHERE status = 'unlisted';
ALTER TABLE blog.posts DROP CONSTRAINT posts_status_check;
ALTER TABLE blog.posts ADD CONSTRAINT posts_status_check CHECK (status IN ('draft', 'published'));
