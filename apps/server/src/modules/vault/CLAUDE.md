# vault 모듈

## 하는 일
AI 작업 세션과 그래프. 세션 저장(판 쌓기), 주제와 연결선, AI 정리 결과의 제안·승인, 변경 기록과 되돌리기, 그래프 배치.
아직 코드 없음 (M1 세션 저장부터 만든다).

## 소유 데이터
스키마 `vault`: node_kinds, edge_kinds, nodes, sessions, session_revisions, attachments, categories, wikis, edges, project_rules,
layouts, node_layout, graph_snapshots, chunks, chunk_embeddings, proposals, changes, edit_leases

## 데이터 묶음
- 세션: nodes(세션) + sessions + session_revisions + attachments + edit_leases(세션)
- 카테고리: nodes(카테고리) + categories
- wiki: nodes(wiki) + wikis (본문 판은 다음 결정 후)
- 연결선: edges(`material`·`link`·`similar`)
- 제안: proposals
- 그래프 배치: layouts + node_layout + graph_snapshots

## 공개 API (`index.ts`)
아직 없음. 예정: 세션 Query(blog의 재료 패널·글감 상자가 읽음)

## 내보내는 이벤트 / 받는 이벤트
예정: `vault.session.saved` / 일거리 결과 제출

## 써도 되는 모듈
platform

## 지켜야 할 것
- 판(session_revisions)은 추가만 한다. 트리거가 UPDATE·DELETE를 막는다
- 민감정보는 첫 저장 전에 지운다 (판은 고칠 수 없으므로)
- 사람이 고친 칸·연결(`pinned`)은 AI가 덮지 않고 제안으로 남긴다
- 사람이 지운 연결은 행을 남겨 AI가 다시 만들지 못하게 한다
- 공개 여부는 Query의 SQL에서 거른 뒤에 개수·순위를 계산한다
- 그래프는 대표 하나 + 선: 대표는 열(`sessions.wiki_id`, `wikis.category_id`), 비어 있으면 도착 구역·미분류. 옮기기는 대표 값 하나만 바꾼다
- 부모를 지워도 자식을 지우지 않는다 (`RESTRICT`·`SET NULL`). 세션은 사람이 직접 지울 때만 휴지통으로
- 글의 자리는 blog 이벤트로 안다
- `space_id`, `device_id`, `blob_hash`는 다른 모듈을 가리키는 값이다 (외래키 없음)

## 하지 말 것
- blog import (vault는 blog를 모른다)
- 다른 모듈의 테이블 접근
- 트랜잭션 안에서 AI 응답이나 외부 호출 기다리기
