# Cairn API 설계

> 객체 구조는 [객체설계.md](객체설계.md), 테이블은 [테이블설계.md](테이블설계.md), 범위와 단계는 [기획서.md](기획서.md) 6장·10장.

---

## 1. 세 입구

| 입구 | 쓰는 쪽 | 인증 | 용도 |
|---|---|---|---|
| REST `/api/*` | 콘솔, 블로그 | 로그인 쿠키 | 화면 데이터와 쓰기 |
| MCP `/mcp` | AI 도구, 러너 | OAuth, 기기 토큰, 작업 토큰 | 세션 저장, 작업 처리 |
| SSE `/api/stream` | 콘솔 | 로그인 쿠키 | 변경 알림 |

웹은 DB에 닿지 않고 REST만 부른다. REST와 MCP는 같은 Service·Query를 부르며, 진입 계층에 판단을 두지 않는다.

**AI의 입구는 `/mcp` 하나다.** Bearer 토큰(기기·작업)은 `/mcp`에서만 요청자가 되고, REST에서는 방문자와 같다 (`ActorGuard`). 방문자가 GET으로 닿는 경로와 응답 코드는 `apps/server/src/modules/platform/http/visitor-surface.api.test.ts`의 표가 원본이다: 새 경로나 열림·막힘이 바뀌면 그 표를 고쳐야 테스트가 통과한다. `/api/health`는 방문자에게 `status`만 주고, 확장·마이그레이션·표 수는 주인과 서버 자신에게만 준다.

---

## 2. 공통 규칙

| 항목 | 규칙 |
|---|---|
| 주소 | 명사 복수형. 상태를 바꾸는 동작은 `POST /:id/<동사>` |
| 버전 | REST는 웹과 함께 배포하므로 주소에 버전을 두지 않는다. MCP는 필드 추가만 하고, 깨지는 변경은 새 도구 이름으로 만들며 스킬을 함께 고친다 |
| 생성 | `requestId`로 중복을 막는다 |
| 수정 | `version`으로 낙관적 잠금. 어긋나면 409 |
| 목록 | 커서 방식 `{ <항목들>, next }`. 페이지 번호는 쓰지 않는다 |
| 오류 | `{ code, message, fields?, scope? }`. 코드는 [객체설계.md](객체설계.md) 3장. DB가 잠시 밀리면(잠금 5초 · 쿼리 30초) 503 `busy`: 같은 요청을 다시 하면 된다 (러너는 다시 보낸다) |
| 형식 | JSON camelCase, ID는 UUIDv7, 시간은 ISO 8601 |
| 공개 범위 | Query가 Actor를 받아 서버에서 거른 뒤 순위와 개수를 계산한다 |
| 타입 | 표 인터페이스의 타입만 가져오는 `<이름>.view.ts`의 `toJSON()`이 실제 모양을 돌려주고, 웹은 이 파일만 `import type`으로 가져온다. `pnpm check`가 어긋남을 잡는다. 웹의 `_lib/types.ts`에는 오류 모양(`ApiError`)만 둔다 |

---

## 3. REST 경로

경로의 원본은 코드다. 아래는 3단계부터 만든 경로이고, 7단계의 스케줄만 아직 없다.

| 메뉴 | 경로 | 단계 |
|---|---|---|
| 작업 | `GET /api/tasks?status=&goalId=&cursor=`, `POST /api/tasks { requestId, instruction, agentId?, goalId? }`, `GET /api/tasks/:id` (+ `goalChain`: 회사 목표부터 이 작업의 목표까지, `runs: [{ seq, startedAt, agentRevision, skill: { name, source, revision, hash } \| null, runnerBuild, cliVersion, model }]`: 빌려 줄 때마다 어떤 규칙으로 돌았는지, 처음부터, `outputs: [{ id, name, kind, mime, sizeBytes, runSeq, createdAt }]`: 이 작업이 만든 결과물, 휴지통 것은 빼고), `POST /api/tasks/:id/cancel { version }` | 3 |
| 결재 | `GET /api/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/decide { version, decision: approve·revise·reject, note? }` | 3 |
| 에이전트 | `GET·POST /api/agents`, `PATCH /api/agents/:id`, `POST /api/agents/:id/pause`, `POST /api/agents/:id/resume`. 한도 칸은 `monthlyLimit`, `fiveHourLimit`, `planStopPercent`. 보고 대상은 `reportsTo` (null이면 주인, 순환·4단계 초과는 422). 목록의 `heartbeat`는 하트비트 설정과 `nextRunAt`(정한 적이 없으면 null). 저장 응답의 `settingsRevision`은 설정 판이고, `GET /api/agents/:id/revisions` → `{ revisions: [{ revision, settings, createdAt }] }`(최근 판부터, 주인만)는 판마다 그때의 설정 칸 전부다. 설정이 바뀐 저장만 판을 올리고 멈춤 · 재개는 올리지 않는다 | 3 |
| 하트비트 | `PUT /api/agents/:id/heartbeat { version, enabled, mode: daily·hourly, atTime?: "09:30", weekdays?: [1..7], everyHours?: 1~24, timeZone, instruction?, goalId? }` (주인만. 처음이면 `version` 0). 일꾼이 1분마다 때가 된 것을 깨워 `general` 작업 "정기 확인"을 만든다 | 조직 |
| 목표 | `GET /api/goals` → `{ goals: [{ id, parentId, title, description, status, sort, openTasks, doneTasks, version }] }`, `POST /api/goals { requestId, title, parentId?, description?, sort? }`, `PATCH /api/goals/:id { version, title?, description?, sort? }`, `POST /api/goals/:id/status { version, status: active·done·dropped }` (주인만. 지우지 않는다. 진행 중인 목표에만 작업과 하위 목표를 더하고, 5단계까지) | 조직 |
| 사용량 | `GET /api/usage` → `{ agents: [{ id, fiveHourTokens, monthTokens, fiveHourLimit, monthlyLimit, planStopPercent, holding }], plan: [{ tool, window, percent, resetsAt, seenAt }] }` (주인만). 확인 전이거나 초기화 시각이 지난 창은 `percent`가 null | 3 |
| AI | `GET /api/ai` → `{ tools: [{ tool, connected, expiresAt, checkedAt, lastError, signin }] }` (`signin`: 진행 중인 웹 로그인 `{ taskId, step, url, userCode }` 또는 null), `PUT /api/ai/claude/token { token }`, `POST /api/ai/claude/test` → `{ taskId, status }` (주인만. 쓸 수 있는 토큰이 없으면 422). 웹 로그인: `POST /api/ai/:tool/signin` → `{ taskId, status }` (tool: `claude` · `codex`, 진행 중이면 그 작업), `POST /api/ai/claude/signin/code { taskId, code }` → `{ taskId, status }` (코드를 받을 차례가 아니거나 Codex면 422), 취소는 `POST /api/tasks/:id/cancel` | 4 |
| 스킬 | 러너 스킬(`cairn-where: runner`: cairn-write · cairn-tidy · cairn-browse · cairn-code)만. `GET /api/runner-skills` → `{ skills: [{ name, description, source: repo·console, revision, revisions, hash, repoChanged, version }] }`, `GET /api/runner-skills/:name` (+ `files`: 지금 쓰는 판, `repo: { hash, files }`, `revisionList: [{ revision, hash, basedOn, note, createdAt }]` 최근 판부터), `GET /api/runner-skills/:name/revisions/:revision` (판 하나, `files`까지), `POST /api/runner-skills/:name/revisions { requestId, files: { 경로: 글 }, note?, version }` → 201 `{ name, source, revision, revisions, version }` (새 판을 쌓고 바로 쓴다. 처음이면 `version` 0), `PUT /api/runner-skills/:name/active { revision: 번호 \| null, version }` (null이면 저장소 판으로). 주인만. 러너 스킬이 아니거나 없는 판은 404, 판이 바뀌었으면 409, 파일 규칙(`SKILL.md` + `references/*.md` 10개 · 하나 64KB · 합쳐 128KB, 앞부분의 `name`과 `cairn-where: runner`)을 어기면 422. `repoChanged`는 쓰는 콘솔 판이 고칠 때 본 저장소 판과 지금 저장소 판이 다를 때(배포로 바뀜) true | 스킬 |
| 결과물 | AI가 작업에서 만든 파일. `GET /api/outputs?kind=&taskId=&trash=1&cursor=` → `{ outputs: [{ id, name, kind: document·slides·sheet·image·video·other, mime, sizeBytes, taskId, taskTitle, runSeq, createdAt, deletedAt, purgeAfter, version }], next, usage: { usedBytes, maxBytes, diskFreeBytes, reserveBytes } }` (최근부터 50개), `GET /api/outputs/:id/file` (늘 `attachment` + `Content-Security-Policy: sandbox`, `?inline=1`은 서버가 파일 앞부분으로 알아본 그림 · PDF · 영상만이고 나머지는 422), `POST /api/outputs/:id/delete { version }`(휴지통 30일) · `/restore { version }` · `/purge { version }`(휴지통에 있는 것만, 204). 주인만. 올리기는 러너만: `PUT /api/outputs/upload` (머리글 `x-cairn-upload`에 `begin_upload`의 표, 본문은 파일 그대로) → `{ id, name, kind, mime, sizeBytes, … }`. 표가 없거나 틀리거나 끝났으면 403, 본문이 표의 크기보다 크면 413, 크기 · 해시가 다르면 422(아무것도 남지 않음), 같은 실행 · 같은 이름에 다른 내용이면 409, 같은 표로 다시 보내면 같은 줄 | 결과물 |
| 기기 | `POST /api/devices/runner { requestId, name }` (주인만. `run` 권한만 가진 기기, 토큰은 이 응답에 한 번) | 3 |
| 러너 | `GET /api/runners` → `{ runners: [{ id, deviceId, accepting, online, lastSeenAt, task: { id, title } \| null, version }] }`, `POST /api/runners/:id/accepting { accepting, version }` (주인만). 이름·종류는 기기 목록(`deviceId`)에서. `online`은 마지막으로 닿은 지 90초 안. 일 받기를 끄면 `next_jobs`가 빈 목록을 돌려주고 하던 일은 끝까지 간다 | 러너 |
| 코드 러너 칸 | `POST /api/devices/code-runner { secret, slot }` → `{ id, name: "코드 러너 <slot>", scopes: ["run", "sandbox"], token }` (로그인 없이. 칸에만 붙는 볼륨의 연결 값이 곧 권한이고 서버 러너의 값과 다르다. `slot`은 1~99. 틀리면 403 `code_runner`, 설치 전 409, 이름을 다른 기기가 쓰면 409, IP당 1시간 30번은 서버 러너와 함께 센다). 칸마다 기기 하나, 부를 때마다 그 기기의 토큰을 바꾼다. 칸 기기의 이름 · 권한은 주인이 바꿀 수 없다(422) ([코드 작업](코드작업.md)) | 코드 러너 칸 |
| 서버 러너 | `POST /api/devices/server-runner { secret }` → `{ id, name: "서버 러너", scopes: ["run"], token }` (로그인 없이. 서버와 러너만 보는 볼륨의 연결 값이 곧 권한. 틀리면 403, 설치 전 409, IP당 1시간 30번). 부를 때마다 같은 기기의 토큰을 바꾼다. 러너가 MCP 앞에서 한 번 부르는 유일한 REST다 | 러너 |
| 소재 | `GET·POST /api/basket/items { requestId, kind, refId?, url?, title?, note? }`, `DELETE /api/basket/items/:id` | 5 |
| 글 연결 | 글 만들기·저장에 `mainWikiId?`, `refWikiIds?`. 공개된 글의 연결은 주인만 바꾼다 | 6 |
| 사진 | `POST /api/posts/:id/assets` (이미지 본문 그대로, 10MB 이하), `GET /api/files/:hash` (공개 글의 사진은 누구나, 나머지는 주인만) | 5 |
| RSS | `/rss.xml` (공개 글 20개, 웹이 서버 API로 만든다) | 5 |
| 지식 | `GET·POST /api/wikis`(`?q=&category=&cursor=`), `GET·PUT /api/wikis/:id`, `GET /api/wiki-scores`, `GET /api/wiki-scores/:id`(주인만), `GET·POST /api/categories`, `PATCH·DELETE /api/categories/:id`, `GET /api/graph`, `GET /api/graph/public` | 6 |
| 변경 묶음 | `GET /api/changes?status=waiting&cursor=`, `POST /api/changes/:id/ops/:seq/decide { version, decision: approve·decline }`, `POST /api/changes/:id/revert { version }` | 6 |
| 백업 | `GET /api/archive.zip` (주인만, 보관 형식) | 6 |
| 세션 정리 | `GET·PUT /api/tidy/settings { autoTidy, version }`, `POST /api/tidy/backlog` → `{ requested, remaining }` (주인만. 기본은 꺼짐. 대표 wiki가 없고 이번 판을 아직 요청하지 않은 세션을 오래된 순으로 20개씩 요청. 실패한 세션은 새 판이 생기면 다시 대상이 된다) | 6 |
| 기능 패키지 | `/api/p/<패키지>/…`: 목록 파일의 `api`가 경로를 정하고 켜진 패키지만 열린다 (꺼지면 404). `browser-tabs`: 탭 읽기 `reads`, 사이트 `sites` · `sites/:id` · `sites/:id/tasks`, 화면 확인 `viewer` (모두 주인만, [브라우저](브라우저.md) 5장). `code-github`: 저장소 `repos`(목록 · 등록 `{ name, url, base?, setup?, checks? }` · `PATCH repos/:id { version, … }`(주소는 못 바꿈) · `POST repos/:id/archive { version }`), 일 맡기기 `POST repos/:id/tasks { requestId, instruction, paths[], agentId? }`(kind `code`, 그때의 저장소 값을 `payload.code`로), PR `pulls?status=` · `pulls/:id`(모두 주인만, [코드 작업](코드작업.md) 5장) | 패키지 |
| 스케줄 | `GET·POST /api/schedules`, `PATCH /api/schedules/:id`, `POST /api/schedules/:id/run`. 에이전트를 정해진 시각에 깨우는 일은 지금 하트비트가 한다 | 7 |

결재는 작업에 묶이지 않는 경우(한도 변경 등)가 있어 작업 아래에 두지 않는다. 결재 메뉴는 위키 제안도 함께 보여 주되, 데이터는 각 모듈이 따로 가진다.

작업 목록의 `lastEvent`는 마지막 실행 기록의 앞 200자다. `POST /api/tasks`의 제목은 지시의 첫 줄, 종류는 `general`이 기본이다. 일 요청 이벤트는 `kind`, `title`, `target*`, `baseVersion`, `priority`까지 적는다.

작업 상태: `queued → running → waiting → running → done`, 실패는 `failed`, 취소는 `cancelled`. 결재 상태: `pending → approved · rejected · revision_requested · cancelled`.

---

## 4. MCP 도구

| 권한 | 도구 | 쓰는 쪽 | 단계 |
|---|---|---|---|
| `upload` | `check_session`, `save_session` | AI 도구 | 있음 |
| `run` | `next_jobs`, `report_progress`, `submit_result`, `release_job` | 러너 | 3 |
| `run` | `begin_upload { task_id, name, size, sha256 }` → `{ upload_path, header, token, expires_at }` | 러너 (결과물 올리기 표) | 결과물 |
| `run` | `ai_login { tool }` → `{ token, expires_at, version }` | 서버 러너 | 4 |
| `run` | `ai_login_refresh { task_id, tool, version, credential }` → `{ version }` | 러너 (Codex 자격 되돌려 쓰기) | 4 |
| `run` | `ai_signin { task_id, url?, user_code?, credential? }` → `{ code, cancelled, status }` | 러너 (웹 로그인) | 4 |
| 작업 토큰 | `request_approval` | 에이전트 | 3 |
| 작업 토큰 | `delegate_task` | 팀장 에이전트 | 조직 |
| `write` | `blog_get_post`, `blog_save_draft`, `basket_get` | 에이전트 | 5 |
| `read_*` | `search_sessions`, `get_session` | AI 도구, 에이전트 | 있음 |
| `read_*` | `search_wikis`, `get_wiki`, `neighbors` | AI 도구, 에이전트 | 6 |
| `tidy` | `submit_changes` | 에이전트 | 6 |
| `run` | `browser_tab_pending {}` → `{ reads: [{ id, url }] }`, `browser_tab_save { id, title?, body?, error? }` → `{ id, status }` | 러너 (탭 읽기, `browser-tabs`가 켜져 있을 때만) | 패키지 |
| `run` | `code_credential { task_id }` → `{ token, api_url, pull: { number, branch } \| null }`, `code_pull_opened { task_id, number, url, branch, head_sha, checks: [{ command, ok }] }` → `{ pull_id, version }` | 코드 러너 칸 (`code-github`가 켜져 있을 때, 그 code 작업의 임대를 쥔 칸만. 토큰은 메모리에만) | 패키지 |

MCP 입력과 응답은 snake_case다.

- `next_jobs { wait_seconds?, limit?, tools?, signin_tools?, own_logins?, browser?, runner_build?, cli_versions? }`는 최대 25초 기다리는 긴 폴링이다. 러너는 할 수 있는 것을 알린다: `tools`는 일할 수 있는 AI CLI, `signin_tools`는 웹 로그인을 대신 돌릴 수 있는 CLI, `own_logins`는 러너가 스스로 가진 로그인(환경 변수 등), `browser`는 서버 브라우저에 붙어 있는지(알리지 않으면 false). 서버는 그 도구의 로그인을 쓸 수 있을 때(또는 `own_logins`에 있을 때)만 에이전트의 일을, `tools`에 있고 서버의 로그인을 쓸 수 있을 때만 연결 확인을, `signin_tools`에 있을 때만 웹 로그인을, `browser`가 true일 때만 브라우저 작업(`browse`)을 빌려 준다. 코드 작업(`code`)은 코드 러너 칸 기기(기기 권한 `sandbox`)에게만 주고, 칸에는 코드 작업만 준다: 러너가 알리는 값이 아니라 기기로 정한다. 갱신 토큰이 바뀌는 도구(Codex)는 서버의 로그인으로 공간에서 한 번에 하나만 돈다. 알리지 않은 값은 거르지 않는다(알리기 전의 러너). 일이 생기면 바로 돌려준다. 응답은 `{ jobs: [{ task, instruction, target, skill, revision_note, agent, run_token, goal_chain, team, subtask_results, rounds_left }] }`. `goal_chain: [{ title }]`은 회사 목표부터 이 작업의 목표까지, `team: [{ agent_id, name, role, status, kinds }]`는 바로 아래 팀(없으면 빈 목록), `subtask_results: [{ task_id, title, agent, status, summary, error }]`는 맡긴 하위 작업의 결과(깨어난 일에만, `summary`는 결과 글의 앞 2,000자), `rounds_left`는 남은 위임 횟수다. 러너는 이 칸을 지시문에 넣기만 한다. 스킬이 있는 일에는 `skill_package: { name, source: repo·console, revision, hash, files }`가 함께 온다: 콘솔에서 고른 판(없으면 저장소 판)이고, 러너는 깔린 스킬 대신 이것을 작업 자리에 깐다(`hash`는 경로 순으로 "경로\0글\0"을 이은 sha256). 러너가 알린 `runner_build`(80자, 이미지의 `CAIRN_RUNNER_BUILD` · 내 컴퓨터는 git 커밋)와 `cli_versions: { 도구: 버전 }`은 빌려 줄 때마다 남기는 실행 기록(`task_runs`)에 에이전트 설정 판 · 스킬 판과 함께 들어간다. 지시문 글은 남기지 않는다.
- `report_progress { task_id, events: [{ kind, body?, tokens? }], request_id?, plan_usage?, model? }`는 기록을 모아 남기고 임대를 연장한다. 기록이 없으면 `events`를 비워 부른다. 응답 `{ status, cancelled, paused, lease_until }`의 `cancelled`로 러너가 작업을 멈춘다. `request_id`를 주면 같은 보고의 토큰을 두 번 세지 않는다. `plan_usage: [{ window, percent, resets_at, status? }]`는 러너가 CLI의 `rate_limit_event`에서 읽은 구독 사용률이다. 어느 도구의 값인지는 작업의 에이전트로 정한다. `model`(120자)은 CLI가 처음 알린 모델로, 이 러너의 마지막 실행 기록에 비어 있을 때 한 번만 남는다.
- `submit_result { task_id, request_id, status: done·failed, result?, error? }`, `release_job { task_id, reason }`. `result`는 자유 형식이고 러너는 마지막 답을 `{ text }`로 보낸다. 응답은 `{ task_id, status }`. 돌려준 이유는 실행 기록에 남는다.
- `request_approval { request_id, action, target_kind, target_id, target_version, note? }`. `request_id`는 작업마다 따로 센다. 동작은 `blog.post.publish`, `sns.post.send`, `task.agent.raise_limit`로 시작한다. 브라우저 에이전트는 `browser.site.publish`(대상 `browser_site`): 서버는 실행하지 않고, 주인이 화면에서 직접 발행한 뒤 승인한다 ([브라우저](브라우저.md) 4장).
- `delegate_task { subtasks: [{ request_id, to_agent_id, title, instruction, kind?, target_kind?, target_id?, target_version? }] }` → `{ subtasks: [{ task_id, to_agent_id, title, status }], waiting: "subtasks" }`. 바로 아래 팀원에게만(아니면 `forbidden`), 받는 에이전트의 권한으로 할 수 있는 종류만(`general` · `draft_post` · `tidy_session`, 아니면 `rule_violation`). 한도(한 번에 5개, 작업 하나에 10개, 깊이 3, 라운드 3)를 넘어도 `rule_violation`이고 메시지에 "한도"가 있다. 실행 중이 아니면 `conflict`. 하위 작업은 위 작업의 목표와 우선순위를 물려받는다. 같은 `request_id`들로 다시 보내면 처음 만든 하위 작업을 돌려주고, 일부만 겹치면 `conflict`다. 맡긴 작업은 `waiting`(기다리는 것: `subtasks`)이 되어 러너가 AI를 끄고 제출하지 않으며, 하위 작업이 모두 끝나면(완료 · 실패 · 취소) 대기열로 돌아가 같은 에이전트가 결과를 받는다. 결재는 누가 올리든 주인이 한다.
- `blog_get_post { post_id }`는 `{ post_id, title, body_md, status, version, tags, main_wiki_id, ref_wiki_ids }`, `blog_save_draft { request_id, post_id?, base_version?, title, body_md, tags?, main_wiki_id?, ref_wiki_ids? }`는 `{ post_id, version, status, url }`를 돌려준다. 볼 수 없는 wiki는 응답에서 빠지고, 넣으면 없는 wiki처럼 404다. 값을 보내지 않으면 그대로, `main_wiki_id: null`과 `ref_wiki_ids: []`는 비우기다. 참고는 20개까지. AI는 임시 글만 쓰고 고친다. `post_id`가 있으면 `base_version`이 꼭 있어야 한다: 사람이 그사이 고친 내용을 AI가 모르고 덮지 않게. `request_id`는 작업 토큰이면 작업마다 따로 센다. 제목 · 본문의 비밀값은 판이 되기 전에 `[지움: 종류]`로 바뀐다. `basket_get {}`은 `{ items }`를 돌려준다.
- `submit_changes { request_id, message, ops: [{ op, target_id?, base_version?, payload }] }`는 vault 소유다. 변경 묶음을 쓰고 `{ change_set_id, ops: [{ seq, verdict, status, reason }] }`로 판정을 바로 돌려준다. `ops`의 대상은 변경마다 다르다: `wiki.create { title, body_md, slug? }`, `wiki.revise { target_id, base_version, title?, body_md }`, `session.assign { target_id, base_version, wiki_id }`, `edge.add`·`edge.remove { src, dst, kind }`, `category.create { name, slug?, color?, description? }`, `category.assign { target_id, base_version, category_id }`. 앞 변경이 만든 것은 `@번호`로 가리킨다 (토큰 하나에 제출 한 번이라 만들고 잇는 일을 한 묶음에 넣는다). 작업은 이벤트가 아니라 러너의 `submit_result`로 끝난다. 끝내는 길이 하나라 둘이 겹치지 않고, 러너가 도중에 죽어도 `change_sets.job_id`가 유일해서 같은 묶음은 한 번만 적용된다.
- `ai_login`은 콘솔에 넣은 AI 토큰을 러너에게 건넨다. 러너는 메모리에만 두고 AI CLI를 띄울 때 환경 변수로만 넘긴다. `POST /api/ai/claude/test`는 `ai_test` 작업을 만들어 러너가 실행한다 (서버 본체에는 AI가 없다). 이 일은 에이전트가 없어 `next_jobs`의 `agent`와 `run_token`이 null이고, 러너 `.env`에 토큰이 있어도 콘솔의 토큰으로 시험한다. 도는 사이 토큰을 바꾸면 옛 토큰의 결과는 버린다. `ai_login`은 기기만 부를 수 있고 만료된 토큰은 주지 않는다. 러너가 일을 빌리기 전에 토큰을 묻지 않는다: 쓸 로그인이 있는지는 서버가 `next_jobs`에서 본다. `ai_login`의 `version`은 실행하는 동안 CLI가 갱신한 자격을 `ai_login_refresh`로 되돌려 쓸 때 보낸다. 되돌려 쓰기는 갱신 토큰이 바뀌는 도구(Codex)만, 그 일을 쥔 러너만, 그 일이 쓴 도구만, 받은 판일 때만이다(다르면 `conflict`: 다른 실행이 먼저 바꿨다). 만료와 연결 확인 결과는 그대로 둔다.
- 웹 로그인: `POST /api/ai/:tool/signin`이 `ai_signin` 작업을 만들고(에이전트·작업 토큰 없음, 도구마다 하나), 러너가 로그인 명령(`claude setup-token` · `codex login --device-auth`)을 PTY에서 대신 돌린다. 러너는 화면에서 찾은 주소(Codex는 코드도)를 `ai_signin { task_id, url, user_code? }`로 알리고, Claude면 주인이 붙여 넣은 코드를 `ai_signin { task_id }`로 2초마다 묻는다(`code`는 로그인이 끝날 때까지 물을 때마다 같은 값이 와서 응답을 잃어도 다시 받는다. 러너는 한 번만 쳐 넣는다. 10분이 지나면 null). 받은 자격은 `ai_signin { task_id, credential }`(Claude는 `sk-ant-oat01-` 토큰, Codex는 `auth.json` 원문 64KB까지)로 넘기면 서버가 같은 트랜잭션에서 잠가 저장하고 작업을 `done`으로 끝낸다. 주소는 정해진 출처·경로만(`AiSigninPolicy`), 그 작업의 임대를 쥔 러너만 부를 수 있다. 주인이 취소하면 `cancelled: true`가 오고 러너는 명령을 끈다. 실패는 `submit_result { status: failed }`이고, `done`은 자격으로만 끝나서 `submit_result`로는 거절한다(`rule_violation`). 끝나거나 러너가 돌려준 로그인 작업에는 주소도 코드도 남기지 않는다(`payload`는 `{ tool }`만). 작업 상세(`GET /api/tasks/:id`)에는 코드의 암호문도 내보내지 않는다. 자격을 넘긴 응답을 잃고 다시 보내면 같은 답(`status: done`)을 준다. 동시에 두 번 시작해도 작업은 하나다(공간·도구마다 advisory 잠금). 주소·코드·자격은 실행 기록에 남기지 않는다. 웹 터미널은 아니다: 오가는 것은 주소, 사람이 붙여 넣은 코드 하나, 받은 자격뿐이다.
- `GET /api/wiki-scores`는 `{ halfLifeDays, cited, groups: [{ categoryId, name, wikis: [점수] }], history: [점수] }`, `GET /api/wiki-scores/:id`는 `{ wiki: 점수, bases: [{ wikiId, title, ratio, amount }] }`다. 점수는 `{ id, title, categoryId, visibility, score(0~100), total, accumulated, inherited, uses, lastUsedAt, replacedBy }`. 읽을 때 계산하고 주인만 본다 (비공개 쓰임이 섞인 값, [wiki 점수](wiki점수.md)).
- `GET /api/graph`와 `GET /api/graph/public`은 `{ nodes: [{ id, kind, label, parent, visibility?, slug? }], edges: [{ src, dst, kind }] }`를 돌려준다. 공개 글이 가리키는 비공개 wiki는 이름 없는 자리(`private-<해시>`)로만 나오고, 진짜 id는 UUIDv7이라 날짜가 드러나서 내보내지 않는다. `neighbors { node_id }`는 `{ node, neighbors: [{ id, kind, label, relation }] }`.
- 결재한 공개의 결과는 `blog.post.published`와 `blog.post.publish_failed`에 `approvalId`, `outcome`을 실어 알린다. 없는 글이나 이미 공개한 글도 실패로 끝난다. `sns.post.send`는 아직 실행하는 곳이 없어 화면에서 고를 수 없다.
- 결재에서 고쳐 달라고 하면 작업이 대기로 돌아가고, 다음 `next_jobs`의 `target`은 결재의 대상이다.
- 결과물: 러너는 AI가 일을 잘 끝냈을 때(제출 전) outputs 폴더의 파일을 하나씩 `begin_upload`로 표를 받아 `PUT {upload_path}`(머리글 `{header}: {token}`)로 보낸다. 표는 임대를 쥔 이번 실행에만 주고(진행 중 · 그 러너 · 임대가 살아 있음), 그 실행 · 이름 · 크기 · sha256에 묶여 10분이다. 파일 본문은 MCP로 보내지 않는다: AI 토큰은 `/mcp`에서만 요청자가 되고 JSON은 512KB까지라서다. 한도는 파일 하나 100MB, 실행 한 번 200개 · 합쳐 1GB, 공간 전체(`CAIRN_OUTPUTS_MAX_GB`, 기본 80), 디스크 여유(`CAIRN_DISK_RESERVE_GB`, 기본 20)이고 넘으면 `rule_violation`. 표를 줄 때 미리 보고, 받을 때 공간을 잠그고 다시 센다
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

Redis 없이 Postgres로 한다. 큐와 DB가 나뉘면 원본이 둘이 되고 설치할 서비스가 하나 늘어난다. MCP 요청은 큐에 넣지 않고 바로 처리해 결과를 돌려준다. 큐는 요청 뒤의 일에만 쓴다.

| 일 | 저장 위치 | 처리 | 실패 처리 |
|---|---|---|---|
| 모듈 이벤트 | `platform.outbox` | 일꾼 | 지수 백오프 |
| AI 작업 | `task.tasks` | 러너 (`FOR UPDATE SKIP LOCKED`) | 임대 만료 후 재시도, 3회 실패 시 실패 표시 |
| 스케줄 (7단계) | `task.schedules` | 일꾼이 작업 생성 | `requestId`로 중복 방지 |

`NOTIFY`는 깨우기 신호로만 쓴다. 신호를 놓쳐도 다음 조회에서 찾는다. 일꾼은 `cairn_outbox`를 듣고 30초마다 한 번 더 확인한다. 콘솔과 러너의 긴 폴링은 `cairn_changes`를 쓴다. 실행 기록 신호에 일꾼이 깨지 않게 채널을 나눴다.

**Redis를 다시 볼 조건**: API 서버 여러 대, 실시간 메시지 초당 수천 건, 러너 수십 대 동시 실행. 그때도 `platform/base`의 클래스만 바꾼다.
