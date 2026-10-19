# platform 모듈

## 하는 일
모든 모듈이 쓰는 공통 기반. DB 연결, 기반 클래스, 오류, 요청자(Actor), 이벤트와 outbox, 서버 상태 확인.
나중에: 파일 저장(blobs), AI 일거리 빌려주기(jobs), 알림, 임베딩 모델 목록.
**비즈니스 규칙을 두지 않는다.** 세션·글 같은 단어가 여기 코드에 나오면 잘못 들어온 것이다.

## 소유 데이터
스키마 `platform`: blobs, idempotency, jobs, notifications, push_subscriptions, embedding_models, outbox
DB 함수: `platform.uuid_v7()`, `platform.forbid_update_delete()` (모든 모듈의 테이블이 씀)

## 데이터 묶음
일거리(jobs), 알림(notifications + push_subscriptions). 아직 코드 없음

## 공개 API (`index.ts`)
- 기반 클래스: `BaseService` · `BaseQuery` · `BaseRepository` · `BaseEntity` · `BaseRequest`(+`RequestFields`) · `BaseResponse` · `BaseGateway` · `BaseTool`
- `Database`, `Sql`·`Row`(라이브러리 타입 별칭), `Actor`와 `OwnerActor`·`DeviceActor`·`VisitorActor`
- 같은 트랜잭션에 들어가는 것: `Outbox`(이벤트), `Idempotency`(같은 request_id는 한 번만)
- `ZipFile`: 라이브러리 없이 zip 만들기 (node:zlib). 앱에 올릴 스킬 묶음, 나중에 보관 형식 내보내기
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

## 하지 말 것
- 다른 모듈 import
- 특정 모듈에만 필요한 기능을 기반 클래스에 넣기
- 기반 클래스를 거치지 않고 다른 모듈이 라이브러리를 쓰게 내보내기
