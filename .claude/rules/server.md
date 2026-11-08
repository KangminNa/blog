---
paths:
  - "apps/server/**"
---

# 서버 코드 규칙

전체는 [docs/객체설계.md](../../docs/객체설계.md). 파일을 만들거나 고치기 전에 그 파일의 종류(이름 끝)를 확인하고 아래를 지킨다.
새 데이터 묶음은 `pnpm new:bundle <모듈>/<묶음> [--menu <그룹>/<이름>] [--tool]`로 만든다. 옛 이름(`.controller` · `.request` · `.response`)은 쓰지 않는다 (`pnpm check`의 구조 검사가 막는다).

| 파일 | 해도 되는 것 | 하면 안 되는 것 |
|---|---|---|
| `*.api.ts` · `*.tool.ts` | Input 만들기 → Service·Query 메서드 **하나** 호출 → View 돌려주기 | if로 비즈니스 분기, Repository·SQL 직접 사용 |
| `*.view.ts` | 행을 받아 내보낼 칸을 `toJSON()`에 적기. 보는 사람마다 다르면 View를 나눈다 | 조회, 저장, 행 펼치기(`...row`), 표 인터페이스 타입 말고 다른 import |
| `*.input.ts` | `static from(raw)`로 모양 검사(`InvalidRequest`). 표의 칸은 `COLUMNS` 한 줄씩, `changes`로 넘긴다 | 의미 검사(도메인의 일), DB |
| `*.api.test.ts` | 보는 사람별 결과: 방문자 · write 기기(`ApiClient.writeDevice`) · 주인 | 손으로 curl 확인 |
| `*.service.ts` | 첫 줄 권한 확인(관리 일은 `assertOwner()`, `assertCan(WRITE)`는 write 기기도 통과), 트랜잭션 하나, 불러오기 → 엔티티 메서드 → 저장, 같은 모듈의 Query로 읽기. 하나를 고치면 `EntityService`의 `change` | 판단 로직, 칼럼을 낱개로 넘기기, 다른 Service 호출, 트랜잭션 안 외부 호출, 다른 데이터 묶음의 Repository 사용(예외: vault의 `ChangeService`) |
| `*.query.ts` | Actor로 공개 범위를 거른 읽기, 행을 View에 넘기기. 표 하나의 읽기는 `static readonly` `QueryTemplate`, 표를 잇거나 모으면 `sql` | 쓰기, 엔티티 반환, Actor 없는 메서드, 행 손 변환, 부를 때마다 쿼리 만들기, `drizzle-orm` 직접 import |
| Entity (`<이름>.ts`) | `TableEntity` 상속. 칸의 규칙은 `RULES`, 상태는 동사형 메서드, `static open` / `static restore(row)`, `view()` | 필드로 칸 복사, 응답·저장을 위한 `get`, import `@nestjs/*`, `postgres`, `Date.now()` 직접 호출 |
| `*.policy.ts` | 입력 → 판단 결과 | 상태 보관, DB |
| `*.repository.ts` | `TableRepository` 상속: 표 이름, `toEntity` 한 줄, 그 표만의 SQL | 칼럼을 나열한 INSERT·UPDATE, 판단, View |
| `*.gateway.ts` | 외부 서비스 호출 | 판단 |
| `*.handler.ts` · `*.job.ts` · `*.action.ts` | 이벤트 하나 받기 / 간격마다 / 주인이 누름 → Service·Query·Gateway 호출. 두 번 불려도 결과가 같게 | 판단, 트랜잭션 직접 열기 |

- 지금 다루는 모듈의 `CLAUDE.md`를 먼저 읽는다. 써도 되는 모듈과 소유 테이블은 `apps/server/modules.json`.
- 다른 모듈은 `index.ts`로만 가져오고, 자기 스키마에만 SQL을 쓴다. 후속 일은 Entity가 `DomainEvent`로 기록한다.
- 칼럼을 아는 곳은 `<모듈>.tables.ts` · `<모듈>.schema.ts`(자동 생성), Entity의 `RULES`, Input의 `COLUMNS`, View의 `toJSON`뿐이다. 마이그레이션 뒤 `pnpm db:rows` (객체설계 6장).
- 객체는 `platform`의 기반 클래스(`EntityService`·`BaseService`·`BaseQuery`·`TableRepository`·`BaseRepository`·`TableEntity`·`BaseEntity`·`BaseRequest`·`BaseGateway`·`BaseTool`)를 상속한다. 같은 행위가 둘 이상이면 기반 클래스로 올린다.
- 외부 라이브러리는 `modules/platform/base` 안에서만 import한다 (`@nestjs/*`, `node:*` 제외). `pnpm check`가 막는다.
- 데이터만 들고 다니는 클래스, 구현이 하나뿐인 추상 클래스를 만들지 않는다. `type`·`interface`는 표 인터페이스, 기반 클래스끼리의 약속, 표 행에 함께 읽는 칸을 더한 모양에만 쓴다.
- 위 종류에 맞지 않는 객체가 필요하면 만들기 전에 사용자와 정하고 `docs/객체설계.md`를 먼저 고친다.
- 진입 계층의 HTTP 요청·응답 타입은 platform의 `HttpRequest`·`HttpResponse`, 쿠키는 `Cookies`만 쓴다. 경로는 `api/…`로 시작한다 (MCP·OAuth 제외).
- API를 만들거나 바꾸면 `<이름>.api.test.ts`에 보는 사람별(방문자·주인) 결과를 적는다. `src/testing/api-client.ts`의 `ApiClient`로 실제 서버를 띄워 부른다. 손으로 curl 확인하지 않고 `pnpm test`로 확인한다.
