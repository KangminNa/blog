# blog 모듈

## 하는 일
방문자가 읽는 블로그. 글(판·발행), 카테고리, 시리즈, 사진, 소재(글을 쓰기 위한 작업대).
지금은 글, 사진, 소재, AI 도구의 초안, AI가 만든 페이지까지 있다. 카테고리·시리즈는 뒤 단계에서.

- `post/`: 글(`Post` + 판 `PostRevision`), 내용(`PostContent`: 제목·본문 md, 앞부분·찾기용 글자), 주소 규칙(`SlugPolicy`).
  `api/posts`: 목록(방문자는 공개 글만, 주인은 공개 범위별 + 탭별 글 수), 주소로 열기(`by-slug/:slug`, 방문자는 공개·링크만),
  편집기용 읽기, 새 글(`requestId`로 한 번만), 고쳐 쓰기(새 판, `version`), 공개 범위(`/status`), 휴지통(`DELETE`)·되살리기(`/restore`).
  글 → wiki 연결은 `Post.linkWikis`: 새 글·고쳐 쓰기·초안 저장의 `mainWikiId`·`refWikiIds` (`blog_save_draft`는 `main_wiki_id`·`ref_wiki_ids`). 보내지 않으면 그대로, 대표 null과 참고 []는 비우기.
  MCP 도구 `blog_get_post`(휴지통 글은 없는 글과 같다)와 `blog_save_draft`(`PostService.saveDraft`, 주소·정렬은 건드리지 않고, 고칠 때는 `base_version`이 꼭 있어야 한다).
  결재한 공개는 `PublishApprovedHandler` → `PostService.publishApproved` → `Post.publishApproved`.
  보관 파일은 `PostArchiveQuery`: 글과, 남은 글이 쓰는 사진 `assets/<해시>.<확장자>`(휴지통 글에만 붙은 사진은 뺀다. 디스크에 없는 파일은 로그만 남기고 뺀다). 글마다 붙은 사진은 앞부분 `cairn_assets`에 적는다.
  복원의 blog 몫은 `PostRestore`(`RestoredPost`, 새 행만 넣는 `PostRestoreRepository`): 사진은 이름의 해시와 파일의 앞부분을 확인하고, `cairn_assets`가 없는 옛 백업은 본문의 `/api/files/<해시>`로 사진 행을 만든다
- `asset/`: 사진(`Asset`, 글 ↔ 파일 한 행), 형식 판단(`ImagePolicy`: 파일의 앞부분으로, PNG · JPEG · WebP · GIF만).
  `POST api/posts/:id/assets`(주인만, 본문이 파일 그대로), `GET api/files/:hash`. 파일은 platform의 `BlobStore`에 있다
- `basket/`: 소재(`BasketItem`, 공간마다 기본 상자 하나를 처음 담을 때 만든다). `api/basket/items`(주인만), MCP 도구 `basket_get`(write 권한).
  브라우저 확장의 "이 페이지 보관"은 MCP `keep_page`(upload 기기, 2차 4단계, `BasketService.keep`): 링크 소재 하나(`actor_type` device), 읽은 글은 비밀값을 지워 메모로, 같은 주소는 한 번(`duplicate`).
  지금은 세션·글·링크·메모만 담는다. 사진·파일은 소재용 올리는 길이 없어 받지 않는다
- `page/`: 페이지(`Page` + 판, 파일 목록 `PageFiles`, 보기 표 `PageTicket`). AI가 만든 HTML 묶음을 바깥 주소(`/pages/<이름>/`)로 내보낸다.
  만들기 작업이 끝나면 `PageBuiltHandler`(`task.page.built`) → `PageService.built`: 페이지가 없으면 만들고(이름은 `Page.nameOf(title)`, 겹치면 번호) 판을 붙여 그 판을 보이게 한다.
  `api/pages`: 목록(주인은 전부 + `lastTaskId`, 그 밖은 공개 페이지의 이름 · 제목만), 상세와 판 목록 · 제목 · 공개 범위(`PATCH`) · 보이는 판 옮기기(`/current`)는 주인만.
  바깥 주소는 `GET api/pages/site/*path`(웹이 `/pages/…`를 넘긴다, `PageQuery.site` → `PageSiteAnswer`). 시험은 task와 이어져 `src/testing/page.api.test.ts`에 있다

엔티티는 `TableEntity`(platform)로 표 한 줄을 들고, Repository(`TableRepository`)는 바뀐 칸만 저장한다 (객체설계 6장). 칼럼을 아는 곳은 `blog.tables.ts`, Entity의 `RULES`, Input의 `COLUMNS`, View의 `toJSON`, 보관·복원이다.
글의 주소·태그·정렬은 `Post.RULES`를 지나 `edit(content, changes)`로 바뀌고(주소의 모양과 겹침은 `SlugPolicy`가 먼저 본다), 공개 범위·휴지통·wiki 연결은 동사 메서드로만 바뀐다.
`Post`는 지금 판·판 수·참고 wiki를 함께 읽어(`LoadedPost`) 판과 참고 wiki를 `saveParts`로 저장하고, 같은 값은 적지 않아 바뀐 것이 없으면 버전도 그대로다. `Asset`은 id가 없어 `BaseEntity`다.
글의 View는 보는 사람마다 둘이다: 비공개까지 보는 요청자는 `PostView` · `PostPageView` · `SavedPostView`, 아니면 `Public…`(wiki 연결 없음). 읽기는 `PostQuery`가, 쓰기 결과는 `Post.view(actor)`가 고른다.

## 소유 데이터
스키마 `blog`: categories, series, posts, post_revisions, assets, post_wiki_refs, pages, page_revisions(추가만)
스키마 `work`: baskets, basket_items

## 데이터 묶음
- 글: posts + post_revisions + post_wiki_refs
- 카테고리: categories
- 사진: assets
- 페이지: pages + page_revisions (파일은 platform.blobs를 값으로)
- 소재: baskets + basket_items

## 공개 API (`index.ts`)
`BlogModule`, `BlogTools`(블로그 도구 목록, mcp 모듈이 모아서 연다)

## 내보내는 이벤트 / 받는 이벤트
`blog.post.published` · `blog.post.updated` · `blog.post.unpublished` · `blog.post.deleted` (v1: postId, slug, title, status, postVersion, mainWikiId, refWikiIds. vault가 글 자리 사본을 갱신한다). 임시 글은 알리지 않아 공개해야 그래프에 나온다.
결재한 공개의 결과: 성공이면 `blog.post.published`에 `approvalId`·`outcome: 'done'`이 붙고(사람의 공개에는 없다), 실패면 `blog.post.publish_failed` (postId, approvalId, outcome: 'failed', error. 글 상태는 싣지 않아 사본을 고치는 데 쓰지 않는다). task가 받아 작업을 끝낸다.

`blog.page.changed` (v1: pageId, name, currentSeq, visibility. 페이지가 생기거나 판이 붙거나 보이는 판 · 공개 범위 · 제목이 바뀔 때. 화면의 변경 신호로 쓴다)

받는 이벤트: `task.approval.granted` 중 `action`이 `blog.post.publish`인 것만 (`CoreWorkers.expect`도 여기서 적는다).
`task.page.built` (taskId, runId, pageId, title, note, files): 페이지의 새 판. 두 번 받아도 판은 하나다 (`page_revisions`의 `UNIQUE(page_id, run_id)`와 `PageRepository.hasRun`)

## 써도 되는 모듈
platform, vault(Query만, 읽기 전용)

## 지켜야 할 것
- 글 → wiki 연결은 blog가 값으로 갖는다 (외래키 없음): 대표 `posts.main_wiki_id`, 참고 `post_wiki_refs`. 발행·수정 때 이벤트로 vault에 알린다
- 이을 wiki는 트랜잭션을 열기 전에 `PostWikiQuery`로 확인한다. 볼 수 없는 wiki는 없는 wiki와 똑같이 404. 연결은 판을 쌓지 않지만 `version`을 올린다 (사본은 `postVersion`이 더 큰 이벤트만 받는다)
- 한 번의 저장에 공개 글의 이벤트는 하나다: `edit` 뒤에 `linkWikis`를 불러 마지막 모습을 싣는다 (`Post.announceUpdate`). 같은 `postVersion`의 뒤 이벤트는 사본이 버린다
- wiki id는 진짜 id라 UUIDv7의 날짜가 드러난다. 방문자 응답에 넣지 않고, 비공개를 볼 수 없는 요청자에게는 볼 수 있는 wiki만 준다
- 방문자 응답에는 공개된 wiki·세션의 정보만 나온다. 비공개면 자리만
- 세션 첨부를 사진으로 쓸 때는 vault Query로 파일 해시를 받아 blog의 `assets`로 복사한다
- 판(post_revisions)은 추가만 한다. 제목·본문이 바뀔 때만 새 판, 주소·태그·정렬·공개 범위는 글에 둔다
- 공개 범위: 임시(draft) · 공개(published) · 링크만(unlisted). 방문자 목록에는 공개 글만, 주소로는 공개·링크만. 임시·휴지통 글은 방문자에게 404
- 공개 범위 바꾸기·휴지통·공개된 글 고치기(wiki 연결 포함)는 주인만 (`Post`가 막는다). AI 도구의 글쓰기 권한은 임시 글까지
- 주인이 아닌데 공개하는 길은 `Post.publishApproved` 하나다: `action`이 `blog.post.publish`인 `ApprovedActor`만 받고 공개만 한다
- 결재한 공개는 올린 버전과 지금 버전이 같을 때만 한다. 같은 결재가 다시 오면 `platform.idempotency`에 남긴 첫 결과를 그대로 다시 낸다 (공개 뒤에는 버전이 달라 다시 판단하면 실패가 된다). 대상이 없어도 실패를 내야 작업이 끝난다: 예외로 던지면 일꾼이 되풀이하다 멈추고 작업은 끝나지 않는다
- AI 도구의 초안(`saveDraft`)은 제목 · 본문의 비밀값을 판이 되기 전에 지운다 (platform의 `SensitivePolicy`). 주인이 편집기로 쓴 글은 지우지 않는다 (사람이 정한 것)
- 기기와 에이전트가 쓴 판의 `actor_type`은 `ai`. `request_id`는 AI가 만들어서 에이전트는 작업마다 따로 센다
- 사진의 공개 여부는 파일이 아니라 그 파일이 붙은 글로 정한다: 공개·링크 공개 글 하나에라도 붙어 있으면 누구나, 나머지는 주인만. 임시·휴지통 글의 사진은 방문자에게 없는 파일과 똑같이 404
- 파일은 트랜잭션 밖에서 쓴다. 파일이 먼저고 행이 나중이다. 행 없이 남은 파일은 다시 올리면 그대로 쓰인다
- 파일을 가리키는 칸(`assets` · `posts.cover_blob_hash` · `basket_items`)은 `BlobStore.registerUse`로 등록해 둔다 (`AssetQuery` · `BasketQuery`의 `usedBlobs`). 새 칸을 만들면 함께 등록한다: 빠뜨리면 platform이 그 파일을 지운다
- 페이지의 파일은 AI가 만든 것이라 믿지 않는다. 바깥 주소의 답에는 늘 격리 머리글을 붙인다 (`PageSiteAnswer.CSP`: `sandbox`에 `allow-same-origin`을 넣지 않는다. 넣으면 페이지의 스크립트가 주인의 로그인으로 API를 부른다). 형식은 파일 이름의 확장자로만 정하고 `nosniff`
- 페이지는 비공개가 기본이다. 방문자와 기기에게 비공개 페이지는 없는 페이지와 똑같이 404이고, 공개는 주인의 `edit`만 한다 (AI · 기기가 공개하는 길은 없다)
- 격리된 페이지 안에서는 쿠키가 실리지 않는다. 비공개 페이지의 딸린 파일은 보기 표(`PageTicket`, 서버 키로 봉인, 30분, 그 페이지 하나)가 든 주소로 받는다. 표 주소는 `no-referrer`로 밖에 실리지 않게 한다 (격리된 페이지는 애초에 Referer를 보내지 않는다. 브라우저로 확인. 머리글은 격리를 모르는 브라우저에 대비해 둔 것이다)
- 판(page_revisions)은 추가만 한다. 되돌리기는 `current_seq`를 옮기는 것이다. 판이 가리키는 파일은 `BlobStore.registerUse`(`PageQuery.usedBlobs`)로 지켜서, 결과물을 지워도 페이지는 남는다
- SVG는 스크립트를 담을 수 있어 받지 않는다. 형식은 요청 머리글이 아니라 파일의 앞부분으로만 정한다
- 소재에는 비공개 자료가 담긴다. REST는 주인만(`assertOwner`, write 권한 기기도 안 된다), MCP는 write 권한으로만 읽는다. 기기가 담는 길은 `keep_page` 하나(upload, 링크만). 링크는 http·https만
- 세션·글을 담을 때는 트랜잭션을 열기 전에 Query로 있는지 확인한다
- 방문자는 공간을 모른다: MVP는 공간 하나라 방문자 읽기는 공간으로 거르지 않는다 (공간이 여럿이 되면 Guard가 주소로 정한다)

## 하지 말 것
- vault의 Service 호출이나 vault 테이블 SQL 접근 (읽기는 vault Query로만)
- vault와 한 트랜잭션에 묶기 (복원만 예외다: platform의 `ArchiveRestoreService`가 트랜잭션을 열고, blog는 자기 스키마에만 쓴다)
