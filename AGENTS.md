# Cairn 작업 규칙

내 서버 하나에서 도는 Personal AI OS. 흩어진 AI 세션을 모아 지식으로 키우고, 에이전트에게 작업을 맡겨 결재하고, 결과를 블로그로 내보낸다.
배경·범위·단계·결정은 [docs/기획서.md](docs/기획서.md),
DB는 [docs/테이블설계.md](docs/테이블설계.md), 서버 코드 구조는 [docs/객체설계.md](docs/객체설계.md), API는 [docs/API설계.md](docs/API설계.md).
진행 중인 리팩토링과 남은 일은 [docs/리팩토링계획.md](docs/리팩토링계획.md) (13장이 지금 상태).

## 지금 단계

단계 계획(기획서 10장)의 1~7단계를 구현했다 (1~6 첫 완성, 그 뒤 코드 작업 병렬([docs/코드작업.md](docs/코드작업.md))과 7 스케줄·알림, AI가 만든 페이지(`/pages/<이름>/`, 기획서 12장 2026-11-12)). 남은 확인은 실제 환경(진짜 AI · GitHub · 칸 이미지 빌드 · 폰 푸시)과 배포다. 8단계(연동·SNS)는 하지 않는다.
다음 기능은 **"서브 나" 1~6단계**다 ([docs/서브나.md](docs/서브나.md), 2026-11-14 승인): 내 세션 · 웹의 일을 모으고, 맡긴 일은 서버의 AI 팀이 AI끼리 목표까지 가고, 사람은 결재만 한다. 저장소에는 **지금 단계에 필요한 것만** 둔다.
쓰지 않는 패키지·폴더·설정을 미리 만들지 않는다. 필요해지는 단계에서 추가한다. 메뉴도 기능이 생길 때 더한다.

```
apps/server/   NestJS. src/modules/<모듈>/ (platform · account · vault · blog · task · mcp), 지도는 modules.json
               모듈마다 CLAUDE.md에 그 모듈의 규칙이 있다
apps/web/      Next.js (App Router). app/(blog)/ 공개 화면, app/admin/<메뉴>/ 콘솔, app/_task/ 작업·결재·에이전트 공용
apps/runner/   러너. 서버에서 일을 빌려 AI CLI로 처리한다. MCP로만 서버와 이야기하고 DB에 닿지 않는다 (서버 러너의 첫 연결만 REST)
apps/egress/   코드 러너 칸의 나가는 프록시. 허용 목록(egress/allow.txt)의 호스트로만 HTTPS 터널을 연다 (docs/코드작업.md)
db/            DB 이미지(Postgres 17 + pgvector + pg_bigm)와 SQL 마이그레이션(dbmate)
packages/cli/  연결 명령 cairn connect · status (스킬 넣기 + MCP 등록 + 로그인). 배포 전에는 pnpm cairn
plugins/       플러그인 (comments-giscus · sync-github · login-github · office · browser-tabs · code-github). 규칙은 plugins/CLAUDE.md, 객체설계 12장
scripts/       모듈 경계 검사, 구조 검사, 규칙 검사(+ 예외 목록 ratchet.json), 묶음 생성기(templates/), 플러그인 화면 맞추기
skills/        AI 도구와 러너의 스킬 (cairn-save · cairn-recall, 러너 전용 cairn-write · cairn-tidy · cairn-browse · cairn-code · cairn-make). 도구 입력 모양을 바꾸면 스킬도 함께 고친다
               러너 스킬은 저장소 판이고, 콘솔(스킬 메뉴)에서 그 위에 판을 쌓으면 서버가 일과 함께 그 판을 보낸다
               앱(ChatGPT·Claude)용 zip은 서버가 여기서 만든다(api/skills). 스크립트 테스트는 packages/cli
docs/          기획 문서 (기획서 · 서브 나 · 테이블 설계 · 객체 설계 · API 설계 · 보관 형식 · 브라우저 · 코드 작업 · wiki 점수)
```

## 명령어

| 명령 | 하는 일 |
|---|---|
| `pnpm dev` | Docker Compose로 db → migrate → server(:4000) · worker(일꾼) → web(:3000) |
| `pnpm check` | Biome 린트 + 타입 검사 + 모듈 경계 검사 + 구조 검사(새 파일 이름, 옆의 API 테스트, 메뉴와 화면, 웹 타입의 출처) + 규칙 검사(웹의 읽기 · 쓰기 훅, `import type`, 파일 길이, 패턴 본보기. 예외 목록 `scripts/ratchet.json`은 줄어들기만 한다) + 안 쓰는 코드 검사(`pnpm deadcode`). 작업을 끝내기 전에 반드시 통과시킨다 |
| `pnpm test` | 테스트 전용 DB(`cairn_test`)를 새로 만들어 단위 + API 테스트, 러너 통합 테스트, 나가는 프록시 시험까지. 개발 DB는 건드리지 않는다. `-- --test-name-pattern=<이름>`으로 골라서 |
| `pnpm slot <1~9> <스크립트>` | 슬롯별 compose 프로젝트·포트·이미지로 실행 (`test`, `dev`, `db:reset` 등). 작업 트리에서 병렬로 일할 때 쓴다 |
| `pnpm db:check` | DB의 모듈 경계 (모듈 사이 외래키, 주인 없는 스키마), 표 인터페이스가 DB와 같은지 |
| `pnpm db:rows` | 마이그레이션 뒤 표 인터페이스(`<모듈>.tables.ts`)를 다시 만든다 |
| `pnpm install-code` | 설치 코드 (아직 주인이 없을 때). 서버 시작 로그에도 나온다 |
| `pnpm run owner reset-password` | 주인 비밀번호 다시 정하기 (표준 입력으로). 모든 로그인이 끝난다 |
| `pnpm plugin …` | 플러그인 상태·켜기·끄기·설정·동작 (`plugins/CLAUDE.md`). 관리 화면 전까지 쓰는 길 |
| `pnpm cairn connect <블로그 주소>` | 이 컴퓨터의 Claude Code(`--tool codex`면 Codex)를 블로그에 연결 (스킬·검토자 넣기 · MCP 등록 · 브라우저 로그인 · 연결 확인). `pnpm cairn status`로 상태 |
| `pnpm runner start` | 이 컴퓨터에서 러너 실행. 설정은 `apps/runner/.env` (`.env.example` 참고). 서버 러너는 compose에 함께 뜨고 스스로 연결한다 |
| `pnpm run restore` | 표준 입력의 백업 zip을 빈 Cairn에 복원. 기본은 미리 보기, `--apply`로 반영 (`docs/보관형식.md`) |
| `pnpm secret:new` | 서버 키(`CAIRN_SECRET_KEY`) 만들기. 비밀값 암호화에 씀 |
| `pnpm secret:rotate` | 서버 키를 바꾼 뒤 저장된 비밀값을 새 키로 다시 암호화 (순서는 `.env.example`) |
| `pnpm new:bundle <모듈>/<묶음> [--menu <그룹>/<이름>] [--tool]` | 새 데이터 묶음(+ 콘솔 메뉴, MCP 도구)의 뼈대. 등록할 줄과 마이그레이션 SQL을 출력한다 (객체설계 6장) |
| `pnpm format` | Biome 포맷·자동 수정 |
| `pnpm db:new <이름>` | 새 마이그레이션 파일 |
| `pnpm db:migrate` / `db:rollback` / `db:reset` / `db:psql` | 마이그레이션 적용 / 하나 되돌리기 / 데이터 지우고 처음부터 / psql 접속 |

## 바꾸지 않는 원칙

1. **원본은 Postgres.** md는 내보내기 형식이다.
2. **들어온 정보는 버리지 않는다.** 세션·글은 판(revision)을 추가만 한다. 판 테이블은 트리거로 UPDATE·DELETE를 막는다.
3. **사람이 정한 것이 우선.** AI는 사람이 고친 칸·연결을 덮지 않고 제안(proposal)으로 남긴다.
4. **vault와 blog는 서로 의존하지 않는다.** 두 스키마 사이에 외래키를 두지 않는다. 글 → wiki 연결은 그래프에서 모두에게 보이지만,
   비공개 wiki·세션의 이름과 내용은 드러나지 않는다. 그래프 형태는 기획서 9장
5. **비공개가 기본.** 공개 여부는 서버에서 거른 뒤에 순위·개수를 계산한다.
6. **서버 본체에는 AI가 없다.** AI 일은 러너(서버의 별도 컨테이너, 내 컴퓨터)나 사용자의 AI 도구가 MCP로 일거리를 빌려 가서 한다.
7. **위험한 동작은 결재 뒤에 실행한다.** 발행, 전송, 삭제는 AI가 직접 하지 못한다.

## 객체 설계 (서버)

[docs/객체설계.md](docs/객체설계.md)를 따른다. 요약:

- 4계층: 진입(Controller·Tool·Guard·View) → 응용(Input·Service·Query) → 도메인(Entity·Policy·Actor) ← 저장(Repository·Gateway)
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
- 웹의 규칙은 `.claude/rules/web.md`, 서버의 규칙은 `.claude/rules/server.md`. 새 기능은 객체설계 11장의 패턴 목록에서 본보기를 골라 시작한다.
- 파일 하나의 코드는 300줄까지 (빈 줄 · 주석 · 시험 · 생성 파일 제외). `helpers` · `utils` · `common` · `misc` 같은 이름을 쓰지 않는다.
- 트랜잭션은 짧게. AI 응답이나 외부 호출을 기다리는 동안 트랜잭션을 열어 두지 않는다.
- 동시 요청은 `request_id`(중복 방지)와 `version`(낙관적 잠금)으로 다룬다. 실패를 조용히 덮지 않는다.
- ID는 UUIDv7. 시간은 `timestamptz`.
- 주석과 사용자에게 보이는 문구는 한국어. 식별자는 영어.
- 화면에 보이는 문구(웹, 화면에 뜨는 서버 오류)는 주어 없이 짧게 쓴다. 예: "이 계정이 블로그의 주인이에요" ✗ → "test1234로 로그인했어요" ✓, "설치 코드가 맞지 않아요" ✗ → "맞지 않는 설치 코드예요" ✓
- 화면 용어는 제품에서 흔히 쓰는 말로 쓴다 (홈, 에이전트, 러너, 소재, 스케줄, 사이트, 초안). 비유를 쓰지 않는다.
- 디자인은 화이트·블랙 단색. 색 토큰은 `globals.css`에만 두고, 강조색 없이 채움·테두리·굵기로 구분한다.
- 스키마 변경은 새 마이그레이션으로만. 커밋된 마이그레이션은 고치지 않는다 (훅이 막는다).

## 작업 순서

1. 관련 문서(위 4개)의 해당 장을 먼저 읽는다. 문서와 다르게 해야 하면 먼저 사용자와 정한다.
2. **구현 전에 인터페이스부터 제안하고 승인받는다.** 입력·출력 타입, 함수·서비스 시그니처, API·MCP 도구 모양,
   쓰는 테이블, 오류 경우를 보여주고, 나중에 생길 일에 어떻게 버티는지와 고르지 않은 대안을 함께 설명한다.
   승인 전에는 구현 코드를 쓰지 않는다.
3. 작게 만들고 `pnpm check`, 필요하면 `pnpm dev`로 실제 동작을 확인한다.
4. 결정이 바뀌면 `docs/기획서.md`의 결정 기록과 관련 문서를 함께 고친다.
5. 커밋은 사용자가 요청할 때만. 메시지는 `종류(범위): 한국어 요약` (예: `feat(server): 세션 저장 API`).
