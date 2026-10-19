# vault 모듈

## 하는 일
AI 작업 세션과 그래프. 세션·wiki 저장(판 쌓기), 카테고리와 연결선, AI 정리 결과의 변경 묶음과 검토 규칙(승인함), 대정리, 변경 기록과 되돌리기, 그래프 보기.
지금은 M1 C 세션 저장까지 있다.

- `session/`: 세션(`Session` + 판 `SessionRevision`), 노트(`SessionNote`: 제목·태그·고정 칸 다섯, 해시, 본문 md),
  2차 민감정보 제거(`SensitivePolicy`), 저장 결과(`SessionReceipt`: saved · unchanged · duplicate).
  MCP 도구 `check_session`(`CheckSessionTool`: 올리기 전 검사, 저장하지 않음. request_id·대화 id·같은 대화의 판 수·지울 민감정보)과 `save_session`(`SaveSessionTool`),
  관리 화면 API `api/sessions`(목록·상세·지난 판, 비공개까지 볼 수 있는 요청자만)

## 소유 데이터
스키마 `vault`: node_kinds, edge_kinds, nodes, sessions, session_revisions, attachments, categories, wikis, wiki_revisions, wiki_aliases,
edges, project_rules, graph_views, node_layout, graph_snapshots, post_marks, chunks, chunk_embeddings,
change_sets, change_ops, review_rules, changes, edit_leases

## 데이터 묶음
- 세션: nodes(세션) + sessions + session_revisions + attachments + edit_leases(세션)
- 카테고리: nodes(카테고리) + categories
- wiki: nodes(wiki) + wikis + wiki_revisions + wiki_aliases
- 연결선: edges(`material`·`link`·`similar`)
- 변경 묶음: change_sets + change_ops (+ 실제로 바뀐 행 changes). 승인함은 검토를 기다리는 change_ops
- 검토 규칙: review_rules
- 그래프 보기: graph_views + node_layout + graph_snapshots
- 글 자리 사본: post_marks (blog 이벤트를 받는 Handler만 쓴다)

## 공개 API (`index.ts`)
`VaultModule`, `CheckSessionTool` · `SaveSessionTool`(mcp 모듈이 모아서 연다). 예정: 세션 Query(blog의 재료 패널·글감 상자가 읽음)

## 내보내는 이벤트 / 받는 이벤트
`vault.session.saved`(v1: sessionId, revisionId, seq, deviceId, project, created) / 예정: `blog.post.*` (글 자리 사본 갱신)

## 써도 되는 모듈
platform

## 지켜야 할 것
- 판(session_revisions · wiki_revisions)은 추가만 한다. 트리거가 UPDATE·DELETE를 막는다
- 그래프를 바꾸는 쓰기는 모두 `ChangeService`를 거쳐 변경 묶음으로 남긴다 (관리 화면 편집 포함). 이 Service만 여러 데이터 묶음의 Repository를 쓴다 (객체설계 4장 예외)
- AI 변경의 바로 합치기·검토·거부는 `ReviewPolicy` 한 곳에서만 판단한다. 규칙을 늘릴 때는 `ReviewRule` 하위 클래스 하나
- 민감정보는 첫 저장 전에 지운다 (판은 고칠 수 없으므로). 새 종류는 `SensitivePolicy.RULES`에 한 줄, 테스트에 한 줄
- 세션 저장은 변경 묶음이 아니라 판으로만 남는다. 같은 대화의 저장은 대화 자리를 잠가 하나씩 처리한다 (`SessionRepository.lockBySource`)
- AI는 공개 여부를 정할 수 없다. 새 세션은 비공개 (프로젝트 규칙은 그 관리 화면이 생길 때 읽는다)
- 사람이 고친 칸·연결(`pinned`)은 AI가 덮지 않고 검토로 남긴다
- 사람이 지운 연결은 행을 남겨 AI가 다시 만들지 못하게 한다
- 공개 여부는 Query의 SQL에서 거른 뒤에 개수·순위를 계산한다
- 그래프는 대표 하나 + 선: 대표는 열(`sessions.wiki_id`, `wikis.category_id`), 비어 있으면 도착 구역·미분류. 옮기기는 대표 값 하나만 바꾼다
- 부모를 지워도 자식을 지우지 않는다 (`RESTRICT`·`SET NULL`). 세션은 사람이 직접 지울 때만 휴지통으로
- 글의 자리는 blog 이벤트로 받은 사본(`post_marks`)으로 안다. `post_version`이 더 큰 이벤트만 반영한다
- `space_id`, `device_id`, `blob_hash`는 다른 모듈을 가리키는 값이다 (외래키 없음)

## 하지 말 것
- blog import (vault는 blog를 모른다)
- 다른 모듈의 테이블 접근
- 트랜잭션 안에서 AI 응답이나 외부 호출 기다리기
