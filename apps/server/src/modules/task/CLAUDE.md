# task 모듈

## 하는 일
에이전트가 일하고 주인이 결재하는 구조. 러너가 일을 빌려 가고, 위험한 동작은 결재를 거치고, 결과가 오면 작업을 끝낸다.
설계는 docs/객체설계.md 13장, API는 docs/API설계.md, 표는 docs/테이블설계.md 6장.

- `agent/`: 에이전트 (`Agent`). 권한, 결재로 맡길 동작, 토큰 한도(한 달 · 5시간), 구독 사용률 멈춤값, 보고 대상(조직도). `api/agents`
- `goal/`: 목표 (`Goal`). 회사 목표부터 이어지는 나무. 작업이 목표 하나에 이어진다. `api/goals`
- `heartbeat/`: 하트비트 (`Heartbeat`, `HeartbeatPolicy`). 에이전트를 정해진 시각에 깨운다. `PUT api/agents/:id/heartbeat`, 일꾼의 `HeartbeatJob`(1분마다)
- `task/`: 작업 (`Task` + 실행 기록 `task_events`). `queued → running → waiting → running → done`, `failed`, `cancelled`.
  `api/tasks`, MCP `next_jobs` · `report_progress` · `submit_result` · `release_job`, 위임 `delegate_task`(작업 토큰)
- `approval/`: 결재 (`Approval`). `pending → approved · rejected · revision_requested · cancelled`.
  `api/approvals`, MCP `request_approval`
- `usage/`: 구독 사용률 (`PlanUsage`)과 사용량 읽기 (`UsageQuery`). `api/usage`. 쓰기는 `report_progress`의 `plan_usage`로만 들어온다
- `ai/`: AI 도구의 로그인 (`AiLogin`, 도구는 claude · codex). 콘솔에 넣거나 웹 로그인으로 받은 자격을 서버 키로 잠가 두고 서버 러너에게 건넨다.
  `api/ai`, MCP `ai_login` · `ai_login_refresh`(CLI가 갱신한 자격 되돌려 쓰기) · `ai_signin`(러너가 로그인 명령을 대신 돌린다), 받는 값의 모양은 `AiSigninPolicy`
- `runner/`: 러너의 상태 (`Runner`). 마지막으로 닿은 때, 일 받기 켜기·끄기. `api/runners`. 기기 이름·종류는 account의 것이라 화면이 합친다

파일 구조 (객체설계 6장): `<이름>.ts` · `.view.ts` · `.input.ts` · `.service.ts` · `.query.ts` · `.api.ts` · `.tool.ts` · `.repository.ts`.
엔티티는 `TableEntity`(platform)로 표 한 줄을 들고 바뀐 칸을 기억하고, Repository(`TableRepository`)는 그 칸만 저장한다. 칼럼을 아는 곳은 `task.tables.ts`, Entity의 `RULES`, Input의 `COLUMNS`, View의 `toJSON`이다.
도구 모양은 docs/API설계.md 4장이 원본이다. `report_progress`는 기록을 모아 받고, 러너가 쓰므로 바꾸면 `apps/runner`도 함께 고친다.

## 소유 데이터
스키마 `task`: agents, goals, heartbeats, tasks, task_events(추가만), approvals, plan_usage, ai_logins, runners

## 데이터 묶음
- 에이전트: agents (조직도는 `reports_to`)
- 목표: goals
- 하트비트: heartbeats (에이전트마다 한 줄)
- 작업: tasks + task_events
- 결재: approvals
- 구독 사용률: plan_usage (창마다 마지막 값 하나. `window`는 Postgres 예약어라 열은 `period`, API는 `window`)
- AI 로그인: ai_logins (공간과 도구마다 한 줄)
- 러너: runners (러너 기기마다 한 줄, 처음 닿을 때 생긴다)

## 공개 API (`index.ts`)
`TaskModule`, `TaskTools`(mcp 모듈이 모아서 연다), `TaskQuery`(`isLive`: mcp 입구가 호출마다 작업 토큰이 살아 있는지 묻는다)

## 내보내는 이벤트
| 이벤트 | 내용 |
|---|---|
| `task.task.changed` | `taskId, status`. 상태가 바뀔 때마다 |
| `task.agent.changed` | `agentId, status` |
| `task.approval.requested` · `granted` · `rejected` · `revision_requested` · `cancelled` | `approvalId, taskId, agentId, action, targetKind, targetId, targetVersion, decidedBy, note` |

`task.approval.granted`를 받은 모듈이 동작을 실행한다. 받는 모듈이 `CoreWorkers.expect`도 적는다 (지금은 blog의 `blog.post.publish`). 실행하는 모듈이 없는 동작은 승인해도 작업이 끝나지 않는다. 기능 패키지의 동작도 같다: `browser.site.publish`는 `browser-tabs`가 받아 "주인이 직접 발행함"을 결과로 남긴다 (패키지가 꺼져 있으면 끝나지 않으니 작업을 취소한다).
변경 신호(SSE)만 있고 이벤트가 아닌 것: `task.event.added` (실행 기록이 쌓임, id는 작업), `task.usage.changed` (구독 사용률이 옴, id는 도구).

## 받는 이벤트
- `task.task.changed`(자기 이벤트): 끝난 하위 작업이면 형제가 모두 끝났는지 보고 위 작업을 깨운다 (`SubtaskSettledHandler`)
- `task.task.requested`: 어느 모듈이든 일을 요청한다. 내용 `requestId, kind, title, instruction?, payload?, targetKind?, targetId?, baseVersion?, agentId?, priority?`. 같은 `requestId`는 작업 하나 (`TaskRequestedHandler`)
- 실행 결과: 주제는 묻지 않는다. 어느 이벤트든 내용에 `approvalId`와 `outcome`(`done` · `failed`)을 실으면 결과다. 실패면 `error`에 이유 (`ApprovalResultHandler`, `*`로 받는다). 두 번 와도 같다

## 써도 되는 모듈
platform

## 지켜야 할 것
- 상태는 set으로 바꾸지 않는다. 메서드마다 어느 상태에서 올 수 있는지 적는다 (`Task.move(from, to)`): 상태 쌍만 보면 `lease()`가 결재 대기를 가로챌 수 있다
- `.view.ts`는 표 인터페이스(`task.tables.ts`)의 타입만 import한다 (`pnpm check`가 막는다). 웹이 `import type`으로 가져온다
- 주인의 일은 `actor.assertOwner()`로 묻는다. `assertCan(WRITE)`로 물으면 write 권한을 가진 기기가 결재할 수 있다
- 작업 토큰은 저장하지 않는다 (`AgentActor.seal`). `RUN_TOKEN_SECONDS`는 상한이고 실제 끝은 임대다: AI CLI는 받은 토큰을 바꿔 끼울 수 없어 임대가 늘어도 끊기면 안 되고, 끝은 호출마다 `TaskQuery.isLive`가 본다
- 작업 토큰은 `/mcp`에서만 Actor가 된다 (`ActorGuard`, 기기 토큰도 같다). REST에서 쓰면 호출마다 하는 작업 확인을 건너뛴다
- 에이전트에게 `run`을 줄 수 없다. 러너만 일을 빌린다
- 보고 대상은 `Agent.reportTo`로만 바꾼다 (순환 · 깊이 4). 바꿀 때는 공간의 에이전트를 모두 잠근다(`lockAll`): 하나만 잠그면 동시에 서로에게 보고하게 바꾸는 둘이 모두 통과한다. 결재는 조직도와 상관없이 늘 주인에게
- 목표는 지우지 않고 상태로 닫는다. 부모는 만들 때 정하고 바꾸지 않는다 (그래서 목표 사슬은 잠그지 않고 읽는다). 진행 중인 목표에만 작업과 하위 목표를 더한다. 목표를 정하는 건 주인만이고 AI는 읽기만 한다
- 진행 보고는 version을 올리지 않는다 (`saveLease`). 보고가 잦아도 주인의 취소가 막히면 안 된다
- 러너가 닿은 때(`RunnerRepository.seen`)도 version을 올리지 않는다: 러너가 자주 닿아도 주인의 켜기·끄기가 막히면 안 된다. `next_jobs` · `report_progress` · `ai_login` · `ai_signin`이 남긴다 (로그인하는 동안 러너는 `ai_signin`만 부른다). 일 받기를 끈 러너의 `next_jobs`는 빈 목록이다
- 잠그는 순서는 어디서나 작업 → 결재 → 에이전트. 작업끼리는 위 작업 → 아래 작업 (취소 전파). 위 작업을 깨우는 쪽은 위 작업만 잠근다
- 하트비트: 주기는 매일(시각 + 요일)과 N시간마다만. 시각 계산은 `HeartbeatPolicy` 한 곳 (크론 라이브러리를 넣지 않는다). 깨우기는 하트비트 → 작업 순서로 쓰고, 작업의 request_id(`heartbeat:<에이전트>:<시각>`)로 한 번만 만든다. 앞 하트비트 작업이 끝나지 않았거나 에이전트가 일을 받을 수 없으면 건너뛴다. 놓친 시각은 몰아서 깨우지 않는다
- 위임: `waiting`에는 늘 기다리는 것(`wait_reason`: approval · subtasks)이 있다 (DB CHECK). 결재 승인 · 고쳐 달라는 말은 결재를 기다리는 작업에만, 깨우기는 하위 작업을 기다리는 작업에만. 받는 쪽 · 종류 · 한도는 `Task`가 막고 LLM에게 맡기지 않는다
- 한도 올리기 결재는 서버만 올린다. 승인은 같은 트랜잭션에서 한도를 두 배로 하고 에이전트를 다시 움직인다
- 쉬기(`Agent.holds`)는 저장하지 않고 그때마다 계산한다. 5시간 토큰이나 구독 사용률에 닿으면 새 일만 안 빌려주고, 달리는 작업은 끝까지 간다. 결재도 `paused`도 없다: `report_progress`가 `paused: true`를 돌려주면 러너가 작업을 돌려주므로 쉬기에는 쓰지 않는다
- 일의 종류마다 필요한 권한은 `Task.SCOPES`에 적는다 (`tidy_session` → `tidy`, `browse` → `browse`, 스킬은 `Task.SKILLS`: `browse` → `cairn-browse`). `browse`는 `read_all` · `write`와 한 에이전트에 함께 두지 않는다 (`Agent` 규칙 + DB CHECK. `write`도 임시 글 · 소재를 연다). `lockNext`가 SQL에서 거르므로 빌렸다가 돌려주지 않고, 맡을 에이전트가 없는 일은 대기열에 남아 뒤의 일을 막지 않는다
- 쉬는지는 작업을 잠그기 전에 따지고 `lockNext`에서 건너뛴다. 빌렸다가 돌려주지 않는다. 일을 빌릴 때와 `UsageQuery`는 같은 `AgentRepository.usage`를 읽는다
- 초기화 시각이 지난 `plan_usage`는 없는 것과 같다 (`PlanUsage.validAt`). 쉬는 데 쓰지 않고 화면에는 확인 전으로 보인다
- `plan_usage`의 도구는 러너의 입력이 아니라 작업의 에이전트로 정한다. 저장은 에이전트 잠금 뒤에, 늘 같은 창 순서로 (서로 막지 않게). 진행 보고처럼 `task.tasks.version`을 올리지 않는다

- AI 토큰은 REST로 돌려주지 않고 로그에 남기지 않는다. 나가는 길은 `ai_login` 하나고, `run` 권한과 함께 기기인지도 본다 (`AiLoginQuery.token`)
- 웹 로그인(`ai_signin`)도 에이전트·작업 토큰 없이 빌려 주고(`Task.AGENTLESS`), 도구마다 하나다. 러너가 다시 빌리면 단계가 처음(`starting`)으로 돌아간다. 주인이 붙여 넣은 코드는 용도 표시(`ai-signin-code:`)를 붙여 `SecretBox.pack`(10분)으로 작업에 두고, 끝날 때까지 물을 때마다 준다 (응답을 잃어도 러너가 다시 받는다). pack은 작업 토큰과 열쇠가 같아서 용도 표시 없이 싸면 주인이 고른 글이 다른 용도의 값으로 풀릴 수 있다. 작업 상세에는 암호문도 내보내지 않는다(`Task.shownPayload`). 시작은 공간·도구마다 advisory 잠금(`lockSigninSlot`): 아직 로그인 줄이 없을 수 있어 행을 잠글 수 없다. 러너가 알리는 주소·코드·자격은 믿지 않는 입력이라 `AiSigninPolicy`로 거르고, 그 작업의 임대를 쥔 러너만 부를 수 있다. 자격을 받으면 같은 트랜잭션에서 로그인을 저장하고 작업을 끝낸다 (작업 → 로그인). `submit_result`의 done은 거절한다. 끝나거나(완료·실패·취소) 대기열로 돌아가면(돌려줌·임대 끝) payload에는 도구만 남긴다. 자격을 넘긴 러너가 다시 보내면 같은 답을 준다(`signinDoneBy`). 로그인하는 동안 러너는 `ai_signin`만 부르므로 여기서도 닿은 때를 남긴다. 주소·코드·자격은 실행 기록에 쓰지 않는다
- 러너는 `next_jobs`로 할 수 있는 것(`tools` · `signin_tools` · `own_logins` · `browser`)을 알리고, 서버가 쓸 수 있는 로그인과 합쳐 그 일만 빌려 준다 (`LeasePolicy`, 에이전트 일은 `ready`를 도구로 거르고 연결 확인 · 웹 로그인은 `lockNext`가 payload의 도구로, 브라우저 작업은 `browser`로 거른다). 갱신 토큰이 바뀌는 도구(`AiLogin.ROTATING`: codex)는 서버의 로그인으로 한 번에 하나만 (`canStart`, 한 번의 호출 안에서도)
- `ai_login_refresh`: 바뀌는 자격의 도구만, 그 일을 쥔 러너만, 받은 판일 때만 (`assertVersion`). 만료와 연결 확인 결과는 두고 자격만 바꾼다(`AiLogin.refresh`). 잠그는 순서는 작업 → 로그인
- Codex의 자격(`auth.json`)은 갱신 토큰이라 만료가 없다 (`expires_at` null)
- 연결 확인(`ai_test`)은 에이전트도 작업 토큰도 없다. 일을 받을 에이전트가 없어도 빌려 주고, 기다리는 확인은 도구마다 하나다. 결과는 작업이 끝날 때 같은 트랜잭션에서 로그인에 적는다 (잠그는 순서는 작업 → 로그인). 작업에 적힌 로그인의 판이 다르면 옛 토큰의 결과라 버린다

## 하지 말 것
- blog·vault·account import. 결재 뒤 실행은 이벤트로 잇는다
- 결재 없이 발행·전송·삭제를 실행하기. 이 모듈은 실행하지 않는다
- 러너의 일을 여기서 하기 (서버 본체에는 AI가 없다)
