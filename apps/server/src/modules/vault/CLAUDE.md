# vault 모듈

## 하는 일
AI 작업 세션과 그래프. 세션·wiki 저장(판 쌓기), 카테고리와 연결선, AI 정리 결과의 변경 묶음과 검토 규칙(승인함), 대정리, 변경 기록과 되돌리기, 그래프 보기.
지금은 세션 저장·찾기·읽기, wiki · 카테고리 · 연결선, 변경 묶음(검토·되돌리기), 세션 정리 요청, 그래프 보기, 글 자리 사본, 보관 형식 내보내기까지 있다. 대정리는 아직 없다.

- `session/`: 세션(`Session` + 판 `SessionRevision`), 노트(`SessionNote`: 제목·태그·고정 칸 다섯, 해시, 본문 md),
  2차 민감정보 제거(platform의 `SensitivePolicy`를 `SessionNote.scrubbedBy`로), 저장 결과(`SessionReceipt`: saved · unchanged · duplicate).
  MCP 도구 `check_session`(`CheckSessionTool`: 올리기 전 검사, 저장하지 않음. request_id·대화 id·같은 대화의 판 수·지울 민감정보)과 `save_session`(`SaveSessionTool`),
  `search_sessions`(`SearchSessionsTool`: 제목·지금 판 본문의 키워드 찾기, pg_bigm `LIKE likequery()`라 대소문자 구분. 순서와 커서는 바뀌지 않는 세션 id)와
  `get_session`(`GetSessionTool`: 지금 판 하나). 두 읽기 도구는 `read_public`이나 `read_all` 중 하나로 열리고(`BaseTool.orScope`), 볼 수 없는 세션은 없는 세션과 똑같이 답한다.
  관리 화면 API `api/sessions`(목록·상세·지난 판, 비공개까지 볼 수 있는 요청자만)
- `wiki/`: wiki(`Wiki` + 판 `WikiRevision`), 본문(`WikiBody`: md 원문과 `##` 제목 단위의 칸 `WikiSection`, 코드 블록 안의 `##`은 제목이 아니다).
  `api/wikis`(목록 `?q=&category=&cursor=`, 하나, 만들기, 고치기, 휴지통 `trash` · `restore` · 목록 `api/wikis/trash`, 대체 `replaces`), MCP `search_wikis` · `get_wiki`(`read_public`이나 `read_all`). 읽기는 방문자도 공개 wiki까지, 쓰기는 주인만
- `wiki-score/`: wiki 점수(docs/wiki점수.md). 식(`WikiScorePolicy`: 입력 → 점수, DB 없음)과 읽기(`WikiScoreQuery`). `api/wiki-scores`(카테고리별 순위 · 히스토리), `api/wiki-scores/:id`. 주인만.
  점수는 표에 두지 않고 읽을 때 계산한다. 점수를 받는 것은 휴지통에 없는 wiki, 쓰임을 주는 것은 세션(대표 · 재료) · 글(대표 · 참고) · 더 새로운 wiki의 링크다.
  지울 만한 wiki 알림: `WikiStaleJob`(6시간마다) → `WikiScoreService.notice` → `StaleWikis`(공간 하나의 알린 기록, `StaleWikiRepository`가 advisory 잠금)가 새 후보만 platform `Notices`로 알린다. 지우지 않는다
- `category/`: 그래프 카테고리(`Category`). `api/categories`(목록은 누구나, 이름이 공개다. 쓰기는 주인만). wiki가 남으면 지우지 못한다(409)
- `edge/`: 연결선(`Edge`, 종류 `EdgeKind`). REST가 아직 없고 변경 묶음으로만 바뀐다 (그래프 단계에서 경로를 더한다)
- `change/`: 변경 묶음(`ChangeSet`), 변경(`ChangeOp` 하위 클래스 하나 = 변경 종류 하나), 대상(`ChangeTarget`: 네 엔티티의 부모, `snapshot`·`rollBack`),
  판정(`ReviewPolicy` + `ReviewRule` 하위 클래스), 잠금(`TargetRepository`, `TargetBoard`), 쓰기 전부(`ChangeService`: `submit` · `edit` · `decide` · `revert`).
  `api/changes`(승인함, 결정, 되돌리기: 주인만), MCP `submit_changes`(`tidy`)
- `tidy/`: 세션 정리 설정(`TidySettings`: 공간마다 한 행, 없으면 꺼짐)과 일 요청. `api/tidy/settings`(주인), `api/tidy/backlog`(대표 wiki가 없고 지금 판을 아직 요청하지 않은 세션을 오래된 순으로 20개까지, 주인).
  `TidyRequestHandler`(`vault.session.saved`)가 켜져 있으면 `task.task.requested`를 outbox로 남긴다. task를 import하지 않는다.
  요청한 판은 같은 트랜잭션에서 `sessions.tidy_requested_seq`에 적는다
- `post-mark/`: 글 자리 사본(`PostMark`). `PostMarkHandler`(`blog.post.*`)만 쓴다. `PostWikiQuery`: 글이 가리킬 wiki를 볼 수 있는지 blog가 묻는 읽기
- `graph/`: 그래프 읽기(`GraphQuery`). `api/graph`(주인), `api/graph/public`(방문자), MCP `neighbors`(`read_public`이나 `read_all`)
- `vault-archive.query.ts`: 보관 형식 파일 (`ArchiveQuery.register`로 등록). `vault-archive.api.ts`: `api/archive.zip`(주인만). platform은 모듈 파일을 모르고, 이 경로의 자리가 다른 곳에 없어 여기 둔다
- `restore/`: 복원의 vault 몫(`VaultRestore`, `ArchiveQuery.registerRestore`로 등록). 파일을 읽는 `RestoredCategory` · `RestoredWiki` · `RestoredSession` · `RestoredEdge` · `RestoredPin` · `RestoredPostMark`, 새 행만 넣는 `VaultRestoreRepository`

엔티티는 `TableEntity`(platform)로 표 한 줄을 들고, Repository(`TableRepository`)는 바뀐 칸만 저장한다 (객체설계 6장). 칼럼을 아는 곳은 `vault.tables.ts`, Entity의 `RULES`, Input의 `COLUMNS`, View의 `toJSON`, 그리고 칸을 다른 형식으로 옮기는 `ChangeOp`의 payload · `snapshot` · 보관 · 복원이다.
- 변경 대상(세션 · wiki · 카테고리 · 선)은 `TargetEntity`, 휴지통으로 가는 점(wiki · 카테고리)은 `GraphNode`다 (`change/change-target.ts`). 변경과 묶음은 `ChangeTarget` 약속으로만 대상을 다룬다
- 열쇠가 `id`가 아닌 표는 읽을 때 `node_id AS id`(세션 · wiki · 카테고리), `space_id AS id`(정리 설정), `post_id AS id`(글 자리 사본)로 맞춘다. 점의 저장소(`NodeRepository` · `GraphNodeRepository`, `change/change-target.repository.ts`)가 새 점을 `vault.nodes`에 먼저 넣고, 휴지통 표시는 점에 따로 적는다
- 없는 대상은 실패가 아니라 `missing`이라 `lockOrNull`로 잠근다. 판(세션 · wiki)은 엔티티가 새 행(`…RevisionNew`)으로 들고 `saveParts`가 넣기만 한다
- 카테고리의 칸은 `Category.RULES` · `COLUMNS`를 지나 `edit(changes)`로 바뀐다(변경 `category.create` · `category.update`가 칸 묶음을 들고 간다). wiki의 제목 · 본문 · 공개 · 카테고리, 세션의 대표 wiki, 선의 지우기 · 되살리기는 동사 메서드로만 바뀐다
- `ChangeOp`과 그래프의 View는 표 한 줄이 아니라 그대로 둔다. `ChangeOp`은 판정한 칸을 `change_ops` 한 줄(`toRow`)로 내놓는다
- wiki · 카테고리의 View는 보는 사람마다 둘이다: 비공개까지 보는 요청자는 `WikiPageView` · `WikiDetailView` · `CategoryListView`, 아니면 `Public…` (`WikiQuery` · `CategoryQuery`가 고른다)

## 소유 데이터
스키마 `vault`: node_kinds, edge_kinds, nodes, sessions, session_revisions, attachments, categories, wikis, wiki_revisions, wiki_aliases,
edges, project_rules, graph_views, node_layout, graph_snapshots, post_marks, chunks, chunk_embeddings,
change_sets, change_ops, review_rules, changes, edit_leases, tidy_settings, stale_wikis

## 데이터 묶음
- 세션: nodes(세션) + sessions + session_revisions + attachments + edit_leases(세션)
- 카테고리: nodes(카테고리) + categories
- wiki: nodes(wiki) + wikis + wiki_revisions + wiki_aliases
- 연결선: edges(`material`·`link`·`replaces`·`similar`)
- 변경 묶음: change_sets + change_ops (+ 실제로 바뀐 행 changes). 승인함은 검토를 기다리는 change_ops
- 검토 규칙: review_rules
- 그래프 보기: graph_views + node_layout + graph_snapshots
- 글 자리 사본: post_marks (blog 이벤트를 받는 Handler와 복원만 쓴다)
- 정리 설정: tidy_settings
- 지울 만한 wiki 알림 기록: stale_wikis (wiki 점수)

## 공개 API (`index.ts`)
`VaultModule`, `VaultTools`(세션·wiki·그래프·변경 묶음 도구 목록, mcp 모듈이 모아서 연다), `SessionQuery`·`GetSessionInput`(blog의 소재가 세션을 확인할 때 읽음), `PostWikiQuery`(blog가 글에 이을 wiki를 확인할 때 읽음)

## 내보내는 이벤트 / 받는 이벤트
| 이벤트 | 내용 (모두 v1) |
|---|---|
| `vault.session.saved` | sessionId, revisionId, seq, deviceId, project, created |
| `vault.session.assigned` | sessionId, wikiId |
| `vault.wiki.saved` | wikiId, revisionId, seq, kind, changeSetId. 새 판이 쌓일 때 |
| `vault.category.changed` | categoryId, name, deleted |
| `vault.edge.changed` | edgeId, src, dst, kind, deleted |
| `vault.change.submitted` | changeSetId, kind, status |
| `vault.change.decided` | changeSetId, seq, status |
| `vault.change.reverted` | changeSetId, revertId |
| `task.task.requested` | requestId(`tidy:<세션>:<판>`), kind(`tidy_session`), title, targetKind, targetId, baseVersion. task 모듈이 받는 일 요청 |

받는 이벤트: `vault.session.saved` (자동 정리. 꺼져 있으면 아무 일 없이 처리됨), `blog.post.*` (글 자리 사본. `postVersion`이 없는 이벤트는 건너뛴다. 글 이벤트에는 `mainWikiId`, `refWikiIds`가 실려 온다)

## 써도 되는 모듈
platform

## 지켜야 할 것
- 파일을 가리키는 칸(`attachments` · `graph_snapshots`)은 `BlobStore.registerUse`로 등록해 둔다 (`SessionQuery` · `GraphQuery`의 `usedBlobs`). 새 칸을 만들면 함께 등록한다: 빠뜨리면 platform이 그 파일을 지운다
- 판(session_revisions · wiki_revisions)은 추가만 한다. 트리거가 UPDATE·DELETE를 막는다
- 그래프를 바꾸는 쓰기는 모두 `ChangeService`를 거쳐 변경 묶음으로 남긴다 (관리 화면 편집 포함). 이 Service만 여러 데이터 묶음의 Repository를 쓴다 (객체설계 4장 예외). `TidyService`가 세션 Repository로 부르는 `noteTidyRequested` 하나는 요청 기록이라 그래프를 바꾸지 않는다
- AI 변경의 바로 합치기·검토·거부는 `ReviewPolicy` 한 곳에서만 판단한다. 규칙을 늘릴 때는 `ReviewRule` 하위 클래스 하나
- 민감정보는 첫 저장 전에 지운다 (판은 고칠 수 없으므로). 무늬는 platform의 `SensitivePolicy`(blog 초안과 같다). 새 종류는 `SensitivePolicy.RULES`에 한 줄, `session.test.ts`에 한 줄, `skills/cairn-save/scripts/secrets.mjs`도 함께
- 세션 저장은 변경 묶음이 아니라 판으로만 남는다. 같은 대화의 저장은 대화 자리를 잠가 하나씩 처리한다 (`SessionRepository.lockBySource`)
- AI는 공개 여부를 정할 수 없다. 새 세션은 비공개 (프로젝트 규칙은 그 관리 화면이 생길 때 읽는다)
- 사람이 고친 칸·연결(`pinned`)은 AI가 덮지 않고 검토로 남긴다. `HumanOwnedRule`은 주인이 값을 바꿔도 `review`보다 느슨해지지 않는다
- 칸 이름 말고 `pinned_sections`에 들어가는 값: `#title`(wiki 제목), `#wiki`(세션의 대표 wiki)
- 판정의 `base_version`은 판정할 때 대상의 version이다. 승인은 이 값과 비교해 어긋나면 `superseded`로 만든다. AI가 적은 version이 다르면 호출을 실패시키지 않고 검토로 보낸다 (늦은 쪽은 제안으로)
- 되돌리기는 `vault.changes`의 before로 새 묶음(kind = revert)을 쓴다. 대상의 지금 version이 그 묶음이 남긴 version과 다르면 409. 사람이 되돌린 선은 사람이 지운 선으로 남는다
- 대상은 `종류:id` 글자 순서로 잠근다 (`TargetRepository.lock`). 묶음 행이 먼저, 그다음 대상
- 작업 토큰의 제출은 작업 하나에 묶음 하나다 (`change_sets.job_id` 유일, 자리 잠금). 한 묶음 안에서 앞 변경이 만든 것은 payload의 `@번호`로 가리킨다. 도구는 작업을 끝내지 않는다
- 변경 종류를 늘릴 때: `ChangeOp` 하위 클래스 하나, AI가 쓰면 `ChangeOps.FOR_AI`와 `ChangeOps.read`, 도구 설명, 스킬. 끝난 변경은 `SettledOp`로만 되살아나 다시 적용되지 않는다
- 사람이 지운 연결은 행을 남겨 AI가 다시 만들지 못하게 한다
- 공개 여부는 Query의 SQL에서 거른 뒤에 개수·순위를 계산한다
- wiki 점수는 주인만 본다 (비공개 쓰임이 섞인 값). 점수의 식을 바꾸면 docs/wiki점수.md의 계산 예와 `wiki-score.policy.test.ts`를 함께 고친다
- wiki를 지우는 것은 사람뿐이다 (`wiki.trash` · `wiki.restore`는 `ChangeOps.FOR_AI`에 없다). 지워도 판 · 선 · 세션의 대표는 남아 되살리면 돌아온다
- 대체(`replaces`)는 wiki끼리만, 옛 wiki 하나에 하나만, 서로 대체는 안 된다. AI의 대체는 `ReplacesRule`이 늘 검토로 보낸다
- 그래프는 대표 하나 + 선: 대표는 열(`sessions.wiki_id`, `wikis.category_id`), 비어 있으면 도착 구역·미분류. 옮기기는 대표 값 하나만 바꾼다
- 부모를 지워도 자식을 지우지 않는다 (`RESTRICT`·`SET NULL`). 세션은 사람이 직접 지울 때만 휴지통으로
- AI가 쓴 wiki 본문·제목도 판이 되기 전에 `SensitivePolicy`로 지운다 (`ChangeService.submit`)
- 보관 파일에 비밀값을 넣지 않는다. 동기화 플러그인은 공간 없는 `SystemActor`로 읽으므로 공간 조건을 그에 맞춘다
- 글의 자리는 blog 이벤트로 받은 사본(`post_marks`)으로 안다. `post_version`이 더 큰 이벤트만 반영한다. `status`는 published와 draft뿐이라 링크만 공개(unlisted)는 draft로 적는다. 휴지통의 글은 대표를 비워 그래프에서 뺀다
- 방문자 그래프는 비공개를 흔적 없이 뺀다. 예외는 공개 글이 가리키는 비공개 wiki 하나: 글 → wiki 연결은 모두에게 보이므로 자리만 남긴다. 이름·주소·날짜가 없고, id는 UUIDv7의 날짜가 드러나지 않게 해시(`private-…`)로 바꾼다 (원칙 4)
- 방문자 그래프의 주소가 비공개 점을 가리키면 null로 둔다 (공개 세션의 대표가 비공개 wiki인 경우). `api/graph/public`은 주인이 불러도 방문자가 보는 그대로다
- 자동 정리는 기본이 꺼짐이다 (저장마다 주인의 구독 토큰). 같은 판의 일 요청은 requestId가 같아 작업이 하나다
- `tidy_requested_seq`는 판이 지금 판보다 뒤처졌을 때만 쌓인 세션 정리가 고른다. 요청이 실패해도 그대로라, 새 판이 쌓이는 것이 다시 시도다. `session.assign`이 version으로 지키므로 이 값을 적어도 세션 `version`은 올리지 않는다
- `space_id`, `device_id`, `blob_hash`는 다른 모듈을 가리키는 값이다 (외래키 없음)
- 복원은 변경 묶음을 거치지 않고 이벤트도 남기지 않는 유일한 쓰기다 (빈 곳에 id를 지켜 넣는 일이라 되돌릴 대상이 없고, 정리 요청이 생기면 안 된다). 칸·해시·찾기용 글은 `SessionNote`·`WikiBody`로 다시 만든다
- 복원한 세션의 `device_id`는 고정 값(`RestoredSession.NO_DEVICE`), `source_session_id`는 세션 id다. 기기가 복원 뒤 저장하는 세션은 새 세션이 되고, 복원 전의 대화를 다시 저장해도 새 세션이 된다 (보관 파일에 기기와 대화 id가 없다)
- 복원은 `post_marks`를 보관 형식의 글 파일 앞부분에서 바로 채운다: blog를 읽지 않고, 이벤트를 남기지 않는다
- 사람이 정한 표시도 보관 파일에 있다: wiki의 `cairn_origin`·`cairn_pinned`, 세션의 `cairn_pinned`, 카테고리의 `origin`·`pinned`. 없는 옛 백업은 사람의 것으로 본다

## 하지 말 것
- blog import (vault는 blog를 모른다)
- 다른 모듈의 테이블 접근
- 트랜잭션 안에서 AI 응답이나 외부 호출 기다리기
