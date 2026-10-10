---
paths:
  - "apps/server/**"
---

# 서버 코드 규칙

전체는 [docs/객체설계.md](../../docs/객체설계.md). 파일을 만들거나 고치기 전에 그 파일의 종류(이름 끝)를 확인하고 아래를 지킨다.

| 파일 | 해도 되는 것 | 하면 안 되는 것 |
|---|---|---|
| `*.controller.ts` · `*.tool.ts` | Request 만들기 → Service·Query 메서드 **하나** 호출 → Response 만들기 | if로 비즈니스 분기, Repository·SQL 직접 사용 |
| `*.response.ts` | Entity·View에서 보는 사람별로 필드 고르기, `toJSON()` | 조회, 저장 |
| `*.request.ts` | `static from(raw)`로 모양 검사(`InvalidRequest`), 값 꺼내기 | 의미 검사(도메인의 일), DB |
| `*.service.ts` | 첫 줄 권한 확인, 트랜잭션 하나, 불러오기 → 엔티티 메서드 → 저장, 같은 모듈의 Query로 읽기 | 판단 로직, 다른 Service 호출, 트랜잭션 안 외부 호출, 다른 데이터 묶음의 Repository 사용(예외: vault의 `ChangeService`) |
| `*.query.ts` | Actor로 공개 범위를 거른 읽기 SQL, View 반환 | 쓰기, 엔티티 반환, Actor 없는 메서드 |
| Entity (`<이름>.ts`) | 상태와 규칙, 상태를 바꾸는 동사형 메서드, `static open` / `static restore` | import `@nestjs/*`, `postgres`, `Date.now()` 직접 호출 |
| `*.policy.ts` | 입력 → 판단 결과 | 상태 보관, DB |
| `*.repository.ts` | 데이터 묶음 하나의 load · lock · save, 행 ↔ 엔티티 변환 | 판단, View |
| `*.gateway.ts` | 외부 서비스 호출 | 판단 |
| `*.handler.ts` · `*.job.ts` · `*.action.ts` | 이벤트 하나 받기 / 간격마다 / 주인이 누름 → Service·Query·Gateway 호출. 두 번 불려도 결과가 같게 | 판단, 트랜잭션 직접 열기 |

- 지금 다루는 모듈의 `CLAUDE.md`를 먼저 읽는다. 써도 되는 모듈과 소유 테이블은 `apps/server/modules.json`.
- 다른 모듈은 `index.ts`로만 가져오고, 자기 스키마에만 SQL을 쓴다. 후속 일은 Entity가 `DomainEvent`로 기록한다.
- 객체는 `platform`의 기반 클래스(`BaseService`·`BaseQuery`·`BaseRepository`·`BaseEntity`·`BaseRequest`·`BaseResponse`·`BaseGateway`·`BaseTool`)를 상속한다.
- 외부 라이브러리는 `modules/platform/base` 안에서만 import한다 (`@nestjs/*`, `node:*` 제외). `pnpm check`가 막는다.
- 데이터만 들고 다니는 클래스, 구현이 하나뿐인 추상 클래스, 즉석 `type`·`interface`를 만들지 않는다.
- 위 종류에 맞지 않는 객체가 필요하면 만들기 전에 사용자와 정하고 `docs/객체설계.md`를 먼저 고친다.
- 진입 계층의 HTTP 요청·응답 타입은 platform의 `HttpRequest`·`HttpResponse`, 쿠키는 `Cookies`만 쓴다. 경로는 `api/…`로 시작한다 (MCP·OAuth 제외).
- API를 만들거나 바꾸면 `<이름>.api.test.ts`에 보는 사람별(방문자·주인) 결과를 적는다. `src/testing/api-client.ts`의 `ApiClient`로 실제 서버를 띄워 부른다. 손으로 curl 확인하지 않고 `pnpm test`로 확인한다.
