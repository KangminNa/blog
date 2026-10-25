# blog 모듈

## 하는 일
방문자가 읽는 블로그. 글(판·발행), 카테고리, 시리즈, 사진, 글감 상자(글을 쓰기 위한 작업대).
지금은 글만 있다 (M4 일부를 2026-10-24에 앞당김). 카테고리·사진·시리즈·글감 상자·블로그 MCP 도구는 M4에서.

- `post/`: 글(`Post` + 판 `PostRevision`), 내용(`PostContent`: 제목·본문 md, 앞부분·찾기용 글자), 주소 규칙(`SlugPolicy`).
  `api/posts`: 목록(방문자는 공개 글만, 주인은 공개 범위별 + 탭별 글 수), 주소로 열기(`by-slug/:slug`, 방문자는 공개·링크만),
  편집기용 읽기, 새 글(`requestId`로 한 번만), 고쳐 쓰기(새 판, `version`), 공개 범위(`/status`), 휴지통(`DELETE`)·되살리기(`/restore`)

## 소유 데이터
스키마 `blog`: categories, series, posts, post_revisions, assets, post_wiki_refs, chunks, chunk_embeddings, stone_log, edit_leases
스키마 `work`: baskets, basket_items

## 데이터 묶음
- 글: posts + post_revisions + post_wiki_refs + edit_leases(글)
- 카테고리: categories
- 사진: assets
- 글감 상자: baskets + basket_items

## 공개 API (`index.ts`)
`BlogModule`

## 내보내는 이벤트 / 받는 이벤트
`blog.post.published` · `blog.post.updated` · `blog.post.unpublished` · `blog.post.deleted` (v1: postId, slug, title, status, postVersion. 받는 곳은 아직 없음, vault가 글 자리 사본을 갱신할 예정) / 없음

## 써도 되는 모듈
platform, vault(Query만, 읽기 전용)

## 지켜야 할 것
- 글 → wiki 연결은 blog가 값으로 갖는다 (외래키 없음): 대표 `posts.main_wiki_id`, 참고 `post_wiki_refs`. 발행·수정 때 이벤트로 vault에 알린다
- 방문자 응답에는 공개된 wiki·세션의 정보만 나온다. 비공개면 자리만
- 세션 첨부를 사진으로 쓸 때는 vault Query로 파일 해시를 받아 blog의 `assets`로 복사한다
- 판(post_revisions)은 추가만 한다. 제목·본문이 바뀔 때만 새 판, 주소·태그·정렬·공개 범위는 글에 둔다
- 공개 범위: 임시(draft) · 공개(published) · 링크만(unlisted). 방문자 목록에는 공개 글만, 주소로는 공개·링크만. 임시·휴지통 글은 방문자에게 404
- 공개 범위 바꾸기·휴지통·공개된 글 고치기는 주인만 (`Post`가 막는다). AI 도구의 글쓰기 권한은 임시 글까지
- 방문자는 공간을 모른다: MVP는 공간 하나라 방문자 읽기는 공간으로 거르지 않는다 (공간이 여럿이 되면 Guard가 주소로 정한다)

## 하지 말 것
- vault의 Service 호출이나 vault 테이블 SQL 접근 (읽기는 vault Query로만)
- vault와 한 트랜잭션에 묶기
