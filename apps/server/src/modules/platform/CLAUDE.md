# platform 모듈

## 하는 일
모든 모듈이 쓰는 공통 기반. DB 연결, 기반 클래스, 오류, 요청자(Actor), 이벤트와 outbox, 변경 신호(`/api/stream`), 서버 상태 확인.
나중에: 파일 저장(blobs), 알림, 임베딩 모델 목록. AI 일거리는 task 모듈이 맡는다.
**비즈니스 규칙을 두지 않는다.** 세션·글 같은 단어가 여기 코드에 나오면 잘못 들어온 것이다.

## 소유 데이터
스키마 `platform`: blobs, idempotency, notifications, push_subscriptions, embedding_models, outbox, plugins, plugin_settings
DB 함수: `platform.uuid_v7()`, `platform.forbid_update_delete()` (모든 모듈의 테이블이 씀)

## 데이터 묶음
- 플러그인(plugins + plugin_settings, `plugin/`): `PluginState`는 열쇠가 이름이고 version 칸이 없어 `BaseEntity`로 두 표의 행(`platform.tables.ts`)을 들고, `PluginRepository`가 늘 덮어쓴다 (ON CONFLICT). 비밀값은 암호화된 칸으로만 들고 View에는 채워졌는지(`isSet`)만 나간다. 목록은 Query가 보는 사람에 맞는 View를 고른다 (주인과 서버 자신 `PluginListView`, 그 밖 `PluginSummaryListView`)
- 서버 상태(`health/`): 표가 아니라 DB 카탈로그를 읽는다. 누구에게나 DB를 읽어 본 뒤 답하고, 방문자는 status만(`HealthView`), 주인과 서버 자신은 확장 · 마이그레이션 · 표 수까지(`HealthDetailView`)
- 알림(notifications + push_subscriptions). 아직 코드 없음

## 공개 API (`index.ts`)
- 기반 클래스: `BaseService` · `EntityService` · `BaseQuery` · `BaseRepository` · `TableRepository` · `BaseEntity` · `TableEntity` · `BaseRequest`(+`RequestFields` · `VersionInput`) · `BaseResponse` · `BaseGateway` · `BaseTool`
- `QueryTemplate`: 미리 만든 읽기 (2026-11-08). 표 하나의 읽기 모양을 `<모듈>.schema.ts`의 표로 만들어 한 번 SQL 글자로 바꿔 두고, 실행은 부를 때 넘긴 연결에서. 조건 · 정렬(`eq` · `and` · `lt` · `desc` …)도 여기서 다시 내보낸다. 모듈은 `drizzle-orm`을 직접 가져오지 않는다
- `Database`, `Sql`·`Row`(라이브러리 타입 별칭), `Actor`와 `OwnerActor`·`DeviceActor`·`AgentActor`·`ApprovedActor`·`SystemActor`·`VisitorActor`.
  권한은 `assertCan(권한)`(기기·에이전트가 받은 권한), 관리 일은 종류로 묻는다: `assertOwner()`(주인만), `assertOwnerOrSystem()`(주인과 명령줄·일꾼: 플러그인, 서버 키 교체, 복원)
- 같은 트랜잭션에 들어가는 것: `Outbox`(이벤트, 변경 신호, 일꾼 깨우기), `ChangeSignal`(내용 없는 신호), `Idempotency`(같은 request_id는 한 번만)
- `ChangeStream`: Postgres LISTEN 연결 하나로 변경 신호를 나눠 준다. SSE와 긴 폴링이 쓴다. 신호는 깨우기용이고 내용은 늘 테이블에 있다
- `SecretRotation`: 서버 키 교체. 비밀값을 가진 모듈이 `register`로 다시 잠그는 방법을 등록
- `CoreWorkers`: 코어 모듈의 이벤트 받기·반복 작업 등록 (`on`, `every`, `expect`)
- `ArchiveQuery`: 보관 형식 파일 묶음. 내용을 가진 모듈이 `onModuleInit`에서 `register`로 자기 파일을, `registerRestore`로 복원을 등록한다
- `ArchiveRestoreService`: 빈 Cairn에 복원 (`preview` · `apply`). GitHub와 zip이 같은 길이다. 주인과 `SystemActor`만 부른다. `steadyRead`: 복원과 겹치지 않게 읽기
- `ArchivePart`(모듈의 복원 몫), `ArchiveRecord`(보관 파일의 앞부분·항목 읽기), `ArchiveBlob`, `ArchiveReport`(개수와 알림)
- `BlobStore`: 내용 주소 파일 저장소 (`Blob`). 트랜잭션 밖에서 부른다
- `ZipFile`: 라이브러리 없이 zip 만들기 (node:zlib). 앱에 올릴 스킬 묶음, 나중에 보관 형식 내보내기
- `ZipReader` · `ZipLimits`: 믿을 수 없는 zip 읽기. 개수·크기 한도, 위험한 이름 거절, CRC 검사. 넘치면 `TooLarge`
- 오류: `DomainError`와 단계별 하위 클래스, `DomainEvent`, `CurrentActor`(Controller 인자 데코레이터)

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
