# Cairn API 설계

> 2026-10-31 확정. 객체 구조는 [객체설계.md](객체설계.md), 테이블은 [테이블설계.md](테이블설계.md), 범위와 단계는 [MVP-기획서.md](MVP-기획서.md) 11장.

---

## 1. 세 입구

| 입구 | 쓰는 쪽 | 인증 | 용도 |
|---|---|---|---|
| REST `/api/*` | 콘솔, 블로그 | 로그인 쿠키 | 화면 데이터와 쓰기 |
| MCP `/mcp` | AI 도구, 러너 | OAuth, 기기 토큰, 작업 토큰 | 세션 저장, 작업 처리 |
| SSE `/api/stream` | 콘솔 | 로그인 쿠키 | 변경 알림 |

웹은 DB에 닿지 않고 REST만 부른다. REST와 MCP는 같은 Service·Query를 부르며, 진입 계층에 판단을 두지 않는다.

---

## 2. 공통 규칙

| 항목 | 규칙 |
|---|---|
| 주소 | 명사 복수형. 상태를 바꾸는 동작은 `POST /:id/<동사>` |
| 버전 | REST는 웹과 함께 배포하므로 주소에 버전을 두지 않는다. MCP는 필드 추가만 하고, 깨지는 변경은 새 도구 이름으로 만들며 스킬을 함께 고친다 |
| 생성 | `requestId`로 중복을 막는다 |
| 수정 | `version`으로 낙관적 잠금. 어긋나면 409 |
| 목록 | 커서 방식 `{ <항목들>, next }`. 페이지 번호는 쓰지 않는다 |
| 오류 | `{ code, message, fields?, scope? }`. 코드는 [객체설계.md](객체설계.md) 3장 |
| 형식 | JSON camelCase, ID는 UUIDv7, 시간은 ISO 8601 |
| 공개 범위 | Query가 Actor를 받아 서버에서 거른 뒤 순위와 개수를 계산한다 |
| 타입 | import가 없는 `<이름>.view.ts`의 `toJSON()`이 실제 모양을 돌려주고, 웹은 이 파일만 `import type`으로 가져온다. `pnpm check`가 어긋남을 잡는다. 기존 `_lib/types.ts`는 단계적으로 없앤다 |

---

## 3. REST 경로

있는 경로는 코드가 원본이다. 아래는 새로 만들 경로다.

| 메뉴 | 경로 | 단계 |
|---|---|---|
| 작업 | `GET /api/tasks?status=&cursor=`, `POST /api/tasks { requestId, instruction, agentId? }`, `GET /api/tasks/:id`, `POST /api/tasks/:id/cancel { version }` | 3 |
| 결재 | `GET /api/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/decide { version, decision: approve·revise·reject, note? }` | 3 |
| 에이전트 | `GET·POST /api/agents`, `PATCH /api/agents/:id`, `POST /api/agents/:id/pause`, `POST /api/agents/:id/resume` | 3 |
| AI | `GET /api/ai`, `PUT /api/ai/claude/token`, `POST /api/ai/:tool/test`, `POST /api/ai/codex/login` | 3~4 |
| 소재 | `GET·POST /api/basket/items { requestId, kind, refId?, url?, title?, note? }`, `DELETE /api/basket/items/:id` | 5 |
| 사진 | `POST /api/posts/:id/assets` (이미지 본문 그대로, 10MB 이하), `GET /api/files/:hash` (공개 글의 사진은 누구나, 나머지는 주인만) | 5 |
| RSS | `/rss.xml` (공개 글 20개, 웹이 서버 API로 만든다) | 5 |
| 지식 | `GET·POST /api/wikis`(`?q=&category=&cursor=`), `GET·PUT /api/wikis/:id`, `GET·POST /api/categories`, `PATCH·DELETE /api/categories/:id`, `GET /api/graph`, `GET /api/graph/public` | 6 |
| 변경 묶음 | `GET /api/changes?status=waiting&cursor=`, `POST /api/changes/:id/ops/:seq/decide { version, decision: approve·decline }`, `POST /api/changes/:id/revert { version }` | 6 |
| 백업 | `GET /api/archive.zip` (주인만, 보관 형식) | 6 |
| 스케줄 | `GET·POST /api/schedules`, `PATCH /api/schedules/:id`, `POST /api/schedules/:id/run` | 7 |

결재는 작업에 묶이지 않는 경우(한도 변경 등)가 있어 작업 아래에 두지 않는다. 결재 메뉴는 위키 제안도 함께 보여 주되, 데이터는 각 모듈이 따로 가진다.

작업 목록의 `lastEvent`는 마지막 실행 기록의 앞 200자다. `POST /api/tasks`의 제목은 지시의 첫 줄, 종류는 `general`이 기본이다. 일 요청 이벤트는 `kind`, `title`, `target*`, `baseVersion`, `priority`까지 적는다.

작업 상태: `queued → running → waiting → running → done`, 실패는 `failed`, 취소는 `cancelled`. 결재 상태: `pending → approved · rejected · revision_requested · cancelled`.

---

## 4. MCP 도구

| 권한 | 도구 | 쓰는 쪽 | 단계 |
|---|---|---|---|
| `upload` | `check_session`, `save_session` | AI 도구 | 있음 |
| `run` | `next_jobs`, `report_progress`, `submit_result`, `release_job` | 러너 | 3 |
| 작업 토큰 | `request_approval` | 에이전트 | 3 |
| `write` | `blog_get_post`, `blog_save_draft`, `basket_get` | 에이전트 | 5 |
| `read_*` | `search_sessions`, `get_session` | AI 도구, 에이전트 | 1라운드 |
| `read_*` | `search_wikis`, `get_wiki`, `neighbors` | AI 도구, 에이전트 | 6 |
| `tidy` | `submit_changes` | 에이전트 | 6 |

MCP 입력과 응답은 snake_case다.

- `next_jobs { wait_seconds?, limit? }`는 최대 25초 기다리는 긴 폴링이다. 일이 생기면 바로 돌려준다. 응답은 `{ jobs: [{ task, instruction, target, skill, revision_note, agent, run_token }] }`.
- `report_progress { task_id, events: [{ kind, body?, tokens? }], request_id? }`는 기록을 모아 남기고 임대를 연장한다. 기록이 없으면 `events`를 비워 부른다 (`heartbeat_jobs`는 두지 않는다). 응답 `{ status, cancelled, paused, lease_until }`의 `cancelled`로 러너가 작업을 멈춘다. `request_id`를 주면 같은 보고의 토큰을 두 번 세지 않는다.
- `submit_result { task_id, request_id, status: done·failed, result?, error? }`, `release_job { task_id, reason }`. 응답은 `{ task_id, status }`. 돌려준 이유는 실행 기록에 남는다.
- `request_approval { request_id, action, target_kind, target_id, target_version, note? }`. `request_id`는 작업마다 따로 센다. 동작은 `blog.post.publish`, `sns.post.send`, `task.agent.raise_limit`로 시작한다.
- `blog_get_post { post_id }`는 `{ post_id, title, body_md, status, version, tags }`, `blog_save_draft { request_id, post_id?, base_version?, title, body_md, tags? }`는 `{ post_id, version, status, url }`를 돌려준다. AI는 임시 글만 쓰고 고친다. `post_id`가 있으면 `base_version`이 꼭 있어야 한다: 사람이 그사이 고친 내용을 AI가 모르고 덮지 않게. `request_id`는 작업 토큰이면 작업마다 따로 센다. `basket_get {}`은 `{ items }`를 돌려준다.
- `submit_changes { request_id, message, ops: [{ op, target_id?, base_version?, payload }] }`는 vault 소유다. 변경 묶음을 쓰고 `{ change_set_id, ops: [{ seq, verdict, status, reason }] }`로 판정을 바로 돌려준다. `ops`의 대상은 변경마다 다르다: `wiki.create { title, body_md, slug? }`, `wiki.revise { target_id, base_version, title?, body_md }`, `session.assign { target_id, base_version, wiki_id }`, `edge.add`·`edge.remove { src, dst, kind }`, `category.create { name, slug?, color?, description? }`, `category.assign { target_id, base_version, category_id }`. 앞 변경이 만든 것은 `@번호`로 가리킨다 (토큰 하나에 제출 한 번이라 만들고 잇는 일을 한 묶음에 넣는다). 작업은 이벤트가 아니라 러너의 `submit_result`로 끝난다. 끝내는 길이 하나라 둘이 겹치지 않고, 러너가 도중에 죽어도 `change_sets.job_id`가 유일해서 같은 묶음은 한 번만 적용된다.
- 도구 입력 모양을 바꾸면 `skills/`를 함께 고친다.

---

## 5. 작업 토큰

러너가 작업을 받으면 서버가 그 에이전트의 권한만 담은 토큰을 함께 준다. `SecretBox.pack`으로 만들어 저장하지 않고, 임대가 끝나면 함께 끝난다. AI CLI는 이 토큰만 받는다. 토큰은 `/mcp`에서만 Actor가 된다. REST에서 쓰면 호출마다 하는 작업 확인을 건너뛰기 때문이다. `ActorGuard`가 토큰을 읽어 Actor를 만들고, 호출마다 작업이 살아 있는지는 `mcp` 모듈이 `task`에 묻는다 (`account`는 `task`를 모른다).

| 값 | 내용 |
|---|---|
| Actor | `AgentActor(spaceId, agentId, taskId, scopes)` |
| 권한 | 에이전트에 정해 둔 권한만 |
| 만료 | 호출마다 임대가 살아 있는지 확인한다. 토큰 자체의 상한은 24시간이다. AI CLI는 받은 토큰을 바꿔 끼울 수 없어서, 임대가 늘어도 끊기지 않게 넉넉히 둔다 |

AI가 세션이나 메일 속 지시문에 속아도 이 권한을 넘을 수 없다.

---

## 6. 실시간 (SSE)

| 항목 | 규칙 |
|---|---|
| 내용 | 변경 신호만 보낸다 (`{ topic, id }`). 화면은 REST로 다시 읽는다 |
| 머리글 | `Content-Type: text/event-stream`, `Cache-Control: no-store, no-transform` |
| 유지 | 25초마다 빈 주석을 보낸다 |
| 재연결 | 브라우저 기본 재연결 후 화면이 다시 읽는다. 놓친 신호는 되돌리지 않는다. 서버가 오류로 답해 브라우저가 포기하면 `use-live`가 3초 뒤 다시 연다 |
| 서버 | Postgres `LISTEN/NOTIFY`를 `platform/stream`이 받아 전달. 내용은 항상 테이블에 있다 |

`no-transform`이 없으면 Next의 압축 때문에 스트림이 끝날 때 한꺼번에 도착한다 (Next 16.4.2의 `next start`, `next dev` rewrite에서 시험, 2026-10-31).

**WebSocket을 쓰지 않는 이유**: 콘솔은 받기만 하고 보내는 일은 REST로 충분하다. 웹 터미널과 공동 편집을 두지 않는다. WebSocket이 필요해지면 고칠 곳은 `platform/stream`과 웹의 `useLive` 훅 두 곳이다.

---

## 7. 큐

Redis 없이 Postgres로 한다.

| 일 | 저장 위치 | 처리 | 실패 처리 |
|---|---|---|---|
| 모듈 이벤트 | `platform.outbox` | 일꾼 | 지수 백오프 |
| AI 작업 | `task.tasks` | 러너 (`FOR UPDATE SKIP LOCKED`) | 임대 만료 후 재시도, 3회 실패 시 실패 표시 |
| 스케줄 | `task.schedules` | 일꾼이 작업 생성 | `requestId`로 중복 방지 |

`NOTIFY`는 깨우기 신호로만 쓴다. 신호를 놓쳐도 다음 조회에서 찾는다.

**Redis를 다시 볼 조건**: API 서버 여러 대, 실시간 메시지 초당 수천 건, 러너 수십 대 동시 실행. 그때도 `platform/base`의 클래스만 바꾼다.
