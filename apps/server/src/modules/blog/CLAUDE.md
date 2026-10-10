# blog 모듈

## 하는 일
방문자가 읽는 블로그. 글(판·발행), 카테고리, 시리즈, 사진, 글감 상자(글을 쓰기 위한 작업대).
아직 코드 없음 (M4에서 만든다).

## 소유 데이터
스키마 `blog`: categories, series, posts, post_revisions, assets, post_wiki_refs, chunks, chunk_embeddings, stone_log, edit_leases
스키마 `work`: baskets, basket_items

## 데이터 묶음
- 글: posts + post_revisions + post_wiki_refs + edit_leases(글)
- 카테고리: categories
- 사진: assets
- 글감 상자: baskets + basket_items

## 공개 API (`index.ts`)
아직 없음

## 내보내는 이벤트 / 받는 이벤트
예정: `blog.post.published` · `blog.post.updated` · `blog.post.unpublished` · `blog.post.deleted` (vault가 글 자리 사본을 갱신) / 없음

## 써도 되는 모듈
platform, vault(Query만, 읽기 전용)

## 지켜야 할 것
- 글 → wiki 연결은 blog가 값으로 갖는다 (외래키 없음): 대표 `posts.main_wiki_id`, 참고 `post_wiki_refs`. 발행·수정 때 이벤트로 vault에 알린다
- 방문자 응답에는 공개된 wiki·세션의 정보만 나온다. 비공개면 자리만
- 세션 첨부를 사진으로 쓸 때는 vault Query로 파일 해시를 받아 blog의 `assets`로 복사한다
- 판(post_revisions)은 추가만 한다

## 하지 말 것
- vault의 Service 호출이나 vault 테이블 SQL 접근 (읽기는 vault Query로만)
- vault와 한 트랜잭션에 묶기
