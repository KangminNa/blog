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
| 타입 | Response의 `toJSON()`이 실제 모양을 돌려주고, 웹은 `import type`으로 가져온다. `pnpm check`가 어긋남을 잡는다. 기존 `_lib/types.ts`는 단계적으로 없앤다 |

---

## 3. REST 경로

있는 경로는 코드가 원본이다. 아래는 새로 만들 경로다.

| 메뉴 | 경로 | 단계 |
|---|---|---|
| 작업 | `GET·POST /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/cancel` | 3 |
| 결재 | `GET /api/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/decide` | 3 |
| 에이전트 | `GET·POST /api/agents`, `PATCH /api/agents/:id`, `POST /api/agents/:id/pause`, `POST /api/agents/:id/resume` | 3 |
| AI | `GET /api/ai`, `PUT /api/ai/claude/token`, `POST /api/ai/:tool/test`, `POST /api/ai/codex/login` | 3~4 |
| 소재 | `GET·POST /api/basket/items`, `DELETE /api/basket/items/:id` | 5 |
| 지식 | `GET /api/wikis`, `GET /api/graph`, `GET /api/graph/public` | 6 |
| 스케줄 | `GET·POST /api/schedules`, `PATCH /api/schedules/:id`, `POST /api/schedules/:id/run` | 7 |

결재는 작업에 묶이지 않는 경우(한도 변경 등)가 있어 작업 아래에 두지 않는다.

---

## 4. MCP 도구

| 권한 | 도구 | 쓰는 쪽 | 단계 |
|---|---|---|---|
| `upload` | `check_session`, `save_session` | AI 도구 | 있음 |
| `run` | `next_jobs`, `report_progress`, `submit_result`, `release_job` | 러너 | 3 |
| `write` | `blog_get_post`, `blog_save_draft`, `request_approval` | 에이전트 | 3~5 |
| `read_*` | `search_sessions`, `get_session`, `neighbors` | AI 도구, 에이전트 | 6 |

- `next_jobs`는 `waitSeconds`(최대 25초)를 받아 긴 폴링으로 동작한다. 일이 생기면 바로 돌려준다.
- `report_progress`는 로그를 남기고 임대를 연장한다. 응답의 `cancelled`로 러너가 작업을 멈춘다.
- 도구 입력 모양을 바꾸면 `skills/`를 함께 고친다.

---

## 5. 작업 토큰

러너가 작업을 받으면 서버가 그 에이전트의 권한만 담은 토큰을 함께 준다. `SecretBox.pack`으로 만들어 저장하지 않고, 임대가 끝나면 함께 끝난다. AI CLI는 이 토큰만 받는다.

| 값 | 내용 |
|---|---|
| Actor | `AgentActor(spaceId, agentId, taskId, scopes)` |
| 권한 | 에이전트에 정해 둔 권한만 |
| 만료 | 임대 만료 시각. 호출마다 임대가 살아 있는지 확인 |

AI가 세션이나 메일 속 지시문에 속아도 이 권한을 넘을 수 없다.

---

## 6. 실시간 (SSE)

| 항목 | 규칙 |
|---|---|
| 내용 | 변경 신호만 보낸다 (`{ topic, id }`). 화면은 REST로 다시 읽는다 |
| 머리글 | `Content-Type: text/event-stream`, `Cache-Control: no-store, no-transform` |
| 유지 | 25초마다 빈 주석을 보낸다 |
| 재연결 | 브라우저 기본 재연결 후 화면이 다시 읽는다. 놓친 신호는 되돌리지 않는다 |
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
