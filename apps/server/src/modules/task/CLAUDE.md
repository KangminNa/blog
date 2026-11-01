# task 모듈

## 하는 일
에이전트가 일하고 주인이 결재하는 구조. 러너가 일을 빌려 가고, 위험한 동작은 결재를 거치고, 결과가 오면 작업을 끝낸다.
설계는 docs/객체설계.md 13장, API는 docs/API설계.md, 표는 docs/테이블설계.md 5.5장.

- `agent/`: 에이전트 (`Agent`). 권한, 결재로 맡길 동작, 토큰 한도(한 달 · 5시간), 구독 사용률 멈춤값. `api/agents`
- `task/`: 작업 (`Task` + `TaskLogEntry`). `queued → running → waiting → running → done`, `failed`, `cancelled`.
  `api/tasks`, MCP `next_jobs` · `report_progress` · `submit_result` · `release_job`
- `approval/`: 결재 (`Approval`). `pending → approved · rejected · revision_requested · cancelled`.
  `api/approvals`, MCP `request_approval`
- `usage/`: 구독 사용률 (`PlanUsage`)과 사용량 읽기 (`UsageQuery`). `api/usage`. 쓰기는 `report_progress`의 `plan_usage`로만 들어온다

파일 구조는 새 규칙의 시범이다 (객체설계 6장): `<이름>.ts` · `.view.ts` · `.input.ts` · `.service.ts` · `.query.ts` · `.api.ts` · `.tool.ts` · `.repository.ts`.
엔티티는 `TrackedEntity`(platform)로 바뀐 열을 기억하고 Repository는 그 열만 저장한다.
도구 모양은 docs/API설계.md 4장이 원본이다. `report_progress`는 기록을 모아 받고, 러너가 쓰므로 바꾸면 `apps/runner`도 함께 고친다.

## 소유 데이터
스키마 `task`: agents, tasks, task_events(추가만), approvals, plan_usage

## 데이터 묶음
- 에이전트: agents
- 작업: tasks + task_events
- 결재: approvals
- 구독 사용률: plan_usage (창마다 마지막 값 하나. `window`는 Postgres 예약어라 열은 `period`, API는 `window`)

## 공개 API (`index.ts`)
`TaskModule`, `TaskTools`(mcp 모듈이 모아서 연다), `TaskQuery`(`isLive`: mcp 입구가 호출마다 작업 토큰이 살아 있는지 묻는다)

## 내보내는 이벤트
| 이벤트 | 내용 |
|---|---|
| `task.task.changed` | `taskId, status`. 상태가 바뀔 때마다 |
| `task.agent.changed` | `agentId, status` |
| `task.approval.requested` · `granted` · `rejected` · `revision_requested` · `cancelled` | `approvalId, taskId, agentId, action, targetKind, targetId, targetVersion, decidedBy, note` |

`task.approval.granted`를 받은 모듈이 동작을 실행한다. 받는 모듈이 `CoreWorkers.expect`도 적는다 (지금은 blog의 `blog.post.publish`). 실행하는 모듈이 없는 동작은 승인해도 작업이 끝나지 않는다.
변경 신호(SSE)만 있고 이벤트가 아닌 것: `task.event.added` (실행 기록이 쌓임, id는 작업), `task.usage.changed` (구독 사용률이 옴, id는 도구).

## 받는 이벤트
- `task.task.requested`: 어느 모듈이든 일을 요청한다. 내용 `requestId, kind, title, instruction?, payload?, targetKind?, targetId?, baseVersion?, agentId?, priority?`. 같은 `requestId`는 작업 하나 (`TaskRequestedHandler`)
- 실행 결과: 주제는 묻지 않는다. 어느 이벤트든 내용에 `approvalId`와 `outcome`(`done` · `failed`)을 실으면 결과다. 실패면 `error`에 이유 (`ApprovalResultHandler`, `*`로 받는다). 두 번 와도 같다

## 써도 되는 모듈
platform

## 지켜야 할 것
- 상태는 set으로 바꾸지 않는다. 메서드마다 어느 상태에서 올 수 있는지 적는다 (`Task.move(from, to)`): 상태 쌍만 보면 `lease()`가 결재 대기를 가로챌 수 있다
- `.view.ts`는 아무것도 import하지 않는다 (`pnpm check`가 막는다). 웹이 `import type`으로 가져온다
- 주인의 일은 `actor.assertOwner()`로 묻는다. `assertCan(WRITE)`로 물으면 write 권한을 가진 기기가 결재할 수 있다
- 작업 토큰은 저장하지 않는다 (`AgentActor.seal`). `RUN_TOKEN_SECONDS`는 상한이고 실제 끝은 임대다: AI CLI는 받은 토큰을 바꿔 끼울 수 없어 임대가 늘어도 끊기면 안 되고, 끝은 호출마다 `TaskQuery.isLive`가 본다
- 작업 토큰은 `/mcp`에서만 Actor가 된다 (`ActorGuard`). REST에서 쓰면 호출마다 하는 작업 확인을 건너뛴다
- 에이전트에게 `run`을 줄 수 없다. 러너만 일을 빌린다
- 진행 보고는 version을 올리지 않는다 (`saveLease`). 보고가 잦아도 주인의 취소가 막히면 안 된다
- 잠그는 순서는 어디서나 작업 → 결재 → 에이전트
- 한도 올리기 결재는 서버만 올린다. 승인은 같은 트랜잭션에서 한도를 두 배로 하고 에이전트를 다시 움직인다
- 쉬기(`Agent.holds`)는 저장하지 않고 그때마다 계산한다. 5시간 토큰이나 구독 사용률에 닿으면 새 일만 안 빌려주고, 달리는 작업은 끝까지 간다. 결재도 `paused`도 없다: `report_progress`가 `paused: true`를 돌려주면 러너가 작업을 돌려주므로 쉬기에는 쓰지 않는다
- 쉬는지는 작업을 잠그기 전에 따지고 `lockNext`에서 건너뛴다. 빌렸다가 돌려주지 않는다. 일을 빌릴 때와 `UsageQuery`는 같은 `AgentRepository.usage`를 읽는다
- 초기화 시각이 지난 `plan_usage`는 없는 것과 같다 (`PlanUsage.validAt`). 쉬는 데 쓰지 않고 화면에는 확인 전으로 보인다
- `plan_usage`의 도구는 러너의 입력이 아니라 작업의 에이전트로 정한다. 저장은 에이전트 잠금 뒤에, 늘 같은 창 순서로 (서로 막지 않게). 진행 보고처럼 `task.tasks.version`을 올리지 않는다

## 하지 말 것
- blog·vault·account import. 결재 뒤 실행은 이벤트로 잇는다
- 결재 없이 발행·전송·삭제를 실행하기. 이 모듈은 실행하지 않는다
- 러너의 일을 여기서 하기 (서버 본체에는 AI가 없다)
