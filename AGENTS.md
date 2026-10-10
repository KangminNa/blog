# Cairn 작업 규칙

AI 작업 세션을 내 서버에 모아 그래프로 키우고, 그 자료로 블로그 글을 쓰는 self-hosted 블로그 엔진.
배경과 결정은 [docs/기획서.md](docs/기획서.md), 범위와 단계는 [docs/MVP-기획서.md](docs/MVP-기획서.md),
DB는 [docs/테이블설계.md](docs/테이블설계.md), 서버 코드 구조는 [docs/객체설계.md](docs/객체설계.md).

## 지금 단계

M0 기반을 마치고 M1(수집)으로 넘어가는 중. 저장소에는 **지금 단계에 필요한 것만** 둔다.
쓰지 않는 패키지·폴더·설정을 미리 만들지 않는다. 필요해지는 단계에서 추가한다.

```
apps/server/   NestJS. src/modules/<모듈>/ (platform · account · vault · blog · mcp), 지도는 modules.json
               모듈마다 CLAUDE.md에 그 모듈의 규칙이 있다
apps/web/      Next.js (App Router)
db/            DB 이미지(Postgres 17 + pgvector + pg_bigm)와 SQL 마이그레이션(dbmate)
plugins/       플러그인 (첫 플러그인: comments-giscus). 규칙은 plugins/CLAUDE.md, 객체설계 12장
scripts/       모듈 경계 검사, 플러그인 화면 맞추기
docs/          기획 문서 (기획서 · MVP 기획서 · 테이블 설계 · 객체 설계 · 보관 형식)
```

## 명령어

| 명령 | 하는 일 |
|---|---|
| `pnpm dev` | Docker Compose로 db → migrate → server(:4000) · worker(일꾼) → web(:3000) |
| `pnpm check` | Biome 린트 + 타입 검사 + 모듈 경계 검사. 작업을 끝내기 전에 반드시 통과시킨다 |
| `pnpm test` | 테스트 전용 DB(`cairn_test`)를 새로 만들어 단위 + API 테스트. 개발 DB는 건드리지 않는다. `-- --test-name-pattern=<이름>`으로 골라서 |
| `pnpm db:check` | DB의 모듈 경계 (모듈 사이 외래키, 주인 없는 스키마) |
| `pnpm plugin …` | 플러그인 상태·켜기·끄기·설정·동작 (`plugins/CLAUDE.md`). 관리 화면 전까지 쓰는 길 |
| `pnpm secret:new` | 서버 키(`CAIRN_SECRET_KEY`) 만들기. 비밀값 암호화에 씀 |
| `pnpm format` | Biome 포맷·자동 수정 |
| `pnpm db:new <이름>` | 새 마이그레이션 파일 |
| `pnpm db:migrate` / `db:rollback` / `db:reset` / `db:psql` | 마이그레이션 적용 / 하나 되돌리기 / 데이터 지우고 처음부터 / psql 접속 |

## 바꾸지 않는 원칙

1. **원본은 Postgres.** md는 내보내기 형식이다.
2. **들어온 정보는 버리지 않는다.** 세션·글은 판(revision)을 추가만 한다. 판 테이블은 트리거로 UPDATE·DELETE를 막는다.
3. **사람이 정한 것이 우선.** AI는 사람이 고친 칸·연결을 덮지 않고 제안(proposal)으로 남긴다.
4. **vault와 blog는 서로 의존하지 않는다.** 두 스키마 사이에 외래키를 두지 않는다. 글 → wiki 연결은 그래프에서 모두에게 보이지만,
   비공개 wiki·세션의 이름과 내용은 드러나지 않는다. 그래프 형태는 MVP 기획서 7.5
5. **비공개가 기본.** 공개 여부는 서버에서 거른 뒤에 순위·개수를 계산한다.
6. **서버에는 AI가 없다.** 정리·글쓰기는 사용자의 AI 도구가 MCP로 일거리를 빌려 간다.

## 객체 설계 (서버)

[docs/객체설계.md](docs/객체설계.md)를 따른다. 요약:

- 4계층: 진입(Controller·Tool·Guard·Response) → 응용(Request·Service·Query) → 도메인(Entity·Policy·Actor) ← 저장(Repository·Gateway)
- 데이터 묶음(항상 같이 바뀌는 데이터) 하나 = 폴더 하나. 쓰기(C·U·D)는 Service 하나, 읽기(R)는 Query 하나에 모은다
- 쓰기는 반드시 엔티티를 거치고, 읽기는 Query가 View를 바로 만든다. Query는 Actor 없이 부를 수 없다
- 트랜잭션은 Service만 연다. Controller·Tool은 메서드 하나만 부른다
- 데이터만 들고 다니는 클래스, 미리 하는 추상화, 즉석 `type`을 만들지 않는다
- 모든 객체는 `platform/base`의 기반 클래스를 상속한다. 외부 라이브러리는 `platform/base` 안에서만 쓰고,
  새 라이브러리는 객체설계 10장 순서(겪은 문제 → 자리 → 비용 → 고치는 범위 → 빼는 방법)로 설득한 뒤 넣는다
- 모듈 = 스키마. 다른 모듈은 `index.ts`로만 쓰고, 다른 모듈 테이블에 SQL을 쓰지 않는다. 모듈 사이 외래키 없음.
  후속 일은 이벤트(outbox)로 알린다

## 코드 규칙

- 웹은 DB에 직접 접근하지 않고 서버 API만 부른다.
- 트랜잭션은 짧게. AI 응답이나 외부 호출을 기다리는 동안 트랜잭션을 열어 두지 않는다.
- 동시 요청은 `request_id`(중복 방지)와 `version`(낙관적 잠금)으로 다룬다. 실패를 조용히 덮지 않는다.
- ID는 UUIDv7. 시간은 `timestamptz`.
- 주석과 사용자에게 보이는 문구는 한국어. 식별자는 영어.
- 스키마 변경은 새 마이그레이션으로만. 커밋된 마이그레이션은 고치지 않는다 (훅이 막는다).

## 작업 순서

1. 관련 문서(위 3개)의 해당 장을 먼저 읽는다. 문서와 다르게 해야 하면 먼저 사용자와 정한다.
2. **구현 전에 인터페이스부터 제안하고 승인받는다.** 입력·출력 타입, 함수·서비스 시그니처, API·MCP 도구 모양,
   쓰는 테이블, 오류 경우를 보여주고, 나중에 생길 일에 어떻게 버티는지와 고르지 않은 대안을 함께 설명한다.
   승인 전에는 구현 코드를 쓰지 않는다.
3. 작게 만들고 `pnpm check`, 필요하면 `pnpm dev`로 실제 동작을 확인한다.
4. 결정이 바뀌면 `docs/기획서.md`의 결정 기록과 관련 문서를 함께 고친다.
5. 커밋은 사용자가 요청할 때만. 메시지는 `종류(범위): 한국어 요약` (예: `feat(server): 세션 저장 API`).
