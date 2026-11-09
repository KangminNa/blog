# platform 모듈

## 하는 일
모든 모듈이 쓰는 공통 기반. DB 연결, 기반 클래스, 오류, 요청자(Actor), 이벤트와 outbox, 변경 신호(`/api/stream`), 서버 상태 확인.
파일 저장(blobs), 보관 형식(archive), 플러그인. 나중에: 알림, 임베딩 모델 목록. AI 일거리는 task 모듈이 맡는다.
**비즈니스 규칙을 두지 않는다.** 세션·글 같은 단어가 여기 코드에 나오면 잘못 들어온 것이다.

## 소유 데이터
스키마 `platform`: blobs, idempotency, notifications, push_subscriptions, embedding_models, outbox, plugins, plugin_settings
DB 함수: `platform.uuid_v7()`, `platform.forbid_update_delete()` (모든 모듈의 테이블이 씀)

## 데이터 묶음
- 플러그인(plugins + plugin_settings, `plugin/`): `PluginState`는 열쇠가 이름이고 version 칸이 없어 `BaseEntity`로 두 표의 행(`platform.tables.ts`)을 들고, `PluginRepository`가 늘 덮어쓴다 (ON CONFLICT). 비밀값은 암호화된 칸으로만 들고 View에는 채워졌는지(`isSet`)만 나간다. 목록은 Query가 보는 사람에 맞는 View를 고른다 (주인과 서버 자신 `PluginListView`, 그 밖 `PluginSummaryListView`)
- 서버 상태(`health/`): 표가 아니라 DB 카탈로그를 읽는다. 누구에게나 DB를 읽어 본 뒤 답하고, 방문자는 status만(`HealthView`), 주인과 서버 자신은 확장 · 마이그레이션 · 표 수까지(`HealthDetailView`)
- 알림(notifications + push_subscriptions). 아직 코드 없음

## 공개 API (`index.ts`)
- 기반 클래스: `BaseService` · `EntityService` · `BaseQuery` · `BaseRepository` · `TableRepository` · `BaseEntity` · `TableEntity` · `BaseRequest`(+`RequestFields` · `VersionInput`) · `BaseGateway` · `BaseTool`
- 코어의 쿼리 도구 (`base/table-query.ts`, 2026-11-08): 조건 규칙(`Rule`)으로 표 하나를 읽고 쓴다. `TableReader`(`rows` · `row` · `exists` · `pageOf`)는 `BaseQuery`가, `TableWriter`(+ `insertRows` · `updateRows` · `deleteRows`)는 `BaseRepository`가 상속한다. 같은 모양은 한 번만 SQL로 만들어 기억한다. 그 기능만의 쿼리는 각 모듈이 `this.sql`로. 모듈은 `drizzle-orm`을 직접 가져오지 않는다
- 기능 패키지: 동작(`Operation` · `Read` · `Command`, `Work`), 입구(`PackageController` · `PackageService` · `PackageTool`), 패키지의 생성된 표가 쓰는 `TableColumns` (객체설계 12장)
- `Database`, `Sql`·`Row`(라이브러리 타입 별칭), `Actor`와 `OwnerActor`·`DeviceActor`·`AgentActor`·`ApprovedActor`·`SystemActor`·`VisitorActor`.
  권한은 `assertCan(권한)`(기기·에이전트가 받은 권한), 관리 일은 종류로 묻는다: `assertOwner()`(주인만), `assertOwnerOrSystem()`(주인과 명령줄·일꾼: 플러그인, 서버 키 교체, 복원)
- 같은 트랜잭션에 들어가는 것: `Outbox`(이벤트, 변경 신호, 일꾼 깨우기), `ChangeSignal`(내용 없는 신호), `Idempotency`(같은 request_id는 한 번만)
- `ChangeStream`: Postgres LISTEN 연결 하나로 변경 신호를 나눠 준다. SSE와 긴 폴링이 쓴다. 신호는 깨우기용이고 내용은 늘 테이블에 있다
- `SecretRotation`: 서버 키 교체. 비밀값을 가진 모듈이 `register`로 다시 잠그는 방법을 등록
- `SensitivePolicy` · `Redaction`: AI가 보낸 글이 판이 되기 전에 비밀값(토큰 · 키 · 비밀번호 값)을 `[지움: 종류]`로 바꾼다. 모양만 보고, 어느 칸을 지울지는 쓰는 모듈이 정한다 (vault 세션 · wiki, blog 초안)
- `CoreWorkers`: 코어 모듈의 이벤트 받기·반복 작업 등록 (`on`, `every`, `expect`)
- `ArchiveQuery`: 보관 형식 파일 묶음. 내용을 가진 모듈이 `onModuleInit`에서 `register`로 자기 파일을, `registerRestore`로 복원을 등록한다
- `ArchiveRestoreService`: 빈 Cairn에 복원 (`preview` · `apply`). GitHub와 zip이 같은 길이다. 주인과 `SystemActor`만 부른다. `steadyRead`: 복원과 겹치지 않게 읽기
- `ArchivePart`(모듈의 복원 몫), `ArchiveRecord`(보관 파일의 앞부분·항목 읽기), `ArchiveBlob`, `ArchiveReport`(개수와 알림)
- `BlobStore`: 내용 주소 파일 저장소 (`Blob`). 트랜잭션 밖에서 부른다
- `ZipFile`: 라이브러리 없이 zip 만들기 (node:zlib). 앱에 올릴 스킬 묶음, 보관 형식 내보내기
- `ZipReader` · `ZipLimits`: 믿을 수 없는 zip 읽기. 개수·크기 한도, 위험한 이름 거절, CRC 검사. 넘치면 `TooLarge`
- 오류: `DomainError`와 단계별 하위 클래스, `DomainEvent`, `CurrentActor`(Controller 인자 데코레이터)

## DB 연결
- 프로세스(server · worker · 명령줄)마다 풀 하나, 최대 10개 (`Database`). LISTEN은 전용 연결 하나를 따로 쓴다 (server의 `ChangeStream`, worker의 outbox). web · runner는 DB에 닿지 않는다
- 연결마다 시간 제한 (`Database.LIMITS`): 잠금 대기 5초, 쿼리 30초, 트랜잭션을 연 채 쉬기 60초. 앞의 둘은 입구(REST 필터 · MCP)에서 `Busy`(503 `busy`)가 되고 러너는 busy면 같은 요청을 다시 보낸다. 쉬다 끊긴 트랜잭션은 우리 코드의 버그라 500으로 둔다
- 시간 제한 없는 트랜잭션(`unlimitedTransaction`)은 복원 쓰기와 `steadyRead` 두 곳만. 새로 쓰기 전에 일을 나눌 수 있는지 먼저 본다
- 트랜잭션은 짧게: 안에서 외부 호출 · AI 응답 · 파일 저장(`BlobStore`)을 기다리지 않는다. 긴 폴링 · SSE는 트랜잭션 밖에서 LISTEN 신호로 기다린다
- 일 빌리기는 `SKIP LOCKED`, 잠그는 순서는 모듈 규칙대로 (task: 작업 → 결재 → 에이전트), 줄이 없을 수도 있는 자리는 advisory 잠금(`pg_advisory_xact_lock`, 트랜잭션이 끝나면 풀림)

## 내보내는 이벤트 / 받는 이벤트
없음 / 없음 (나중에 알림이 각 모듈의 이벤트를 받는다)

## 써도 되는 모듈
없음. platform은 다른 모듈을 모른다.

## 지켜야 할 것
- 외부 라이브러리는 `base/` 안에서만 가져온다. 새 라이브러리는 docs/객체설계.md 10장 순서로 제안하고 승인받은 뒤 넣는다
- 기반 클래스는 얇게: 모든 하위 클래스가 똑같이 하는 일만 넣는다
- 기반 클래스의 동작을 바꾸면 `base/base.test.ts`에 테스트를 더한다
- 같은 트랜잭션에 들어가야 하는 기능(outbox 등)은 호출한 쪽의 `Sql`(트랜잭션)을 받는 클래스로 만든다
- 복원은 모듈을 한 트랜잭션에 묶는 유일한 곳이다: 실패하면 Cairn이 비어 있는 채로 남아야 해서다. `ArchiveRestoreService`가 트랜잭션을 열고 모듈은 자기 스키마에만 쓴다. 이벤트는 남기지 않는다
- 복원의 잠금은 두 가지다: 복원끼리와 `steadyRead`는 advisory 잠금, 빈 곳 확인은 모듈이 표를 잠근다 (`ArchivePart.existing`)

## 하지 말 것
- 다른 모듈 import
- 특정 모듈에만 필요한 기능을 기반 클래스에 넣기
- 기반 클래스를 거치지 않고 다른 모듈이 라이브러리를 쓰게 내보내기
