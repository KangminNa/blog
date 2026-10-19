# Cairn

**AI와 함께 일한 세션을 모아 그래프로 키우고, 그 자료로 블로그 글을 쓰는 self-hosted 오픈소스 블로그 엔진.**

> 상태: **개발 시작 (M0 진행 중).** 개발 환경과 DB 스키마까지 준비됐습니다. "설치 (예정)"의 명령은 아직 동작하지 않습니다.

---

## Cairn이 하는 일

Claude Code나 Codex 같은 AI 도구로 일하면 하루에도 여러 개의 작업 세션이 생깁니다. 문제를 푼 과정, 설계 판단, 시행착오가 모두 들어 있지만, 세션은 컴퓨터마다 흩어지고 다시 열리지 않습니다.

Cairn은 이 세션들을 한곳에 모읍니다. 세션 하나가 돌 하나라면, 쌓인 돌탑이 다음 작업의 길잡이가 됩니다.

| | |
|---|---|
| **모은다** | 여러 컴퓨터의 AI 세션을 스킬 한 번으로 내 서버에 올립니다 |
| **자란다** | 내 AI 도구가 세션을 주제별로 정리하고 연결해 그래프로 키웁니다 |
| **다시 쓴다** | 다른 컴퓨터의 AI 도구가 MCP로 과거 세션을 찾아 작업에 참고합니다 |
| **꺼낸다** | 세션과 사진, 참고 자료로 읽기 편한 블로그 글을 씁니다 |

---

## 이런 분께 맞습니다

- Claude Code, Codex 같은 AI 코딩 도구를 매일 쓰는 개발자
- 여러 컴퓨터를 오가며 작업하는 사람
- 작업 과정을 기록하고 공개하고 싶지만, 처음부터 글을 쓰기는 부담스러운 사람
- 데이터를 내 서버에 두고 싶은 사람

지금은 Docker로 서버를 직접 띄울 줄 아는 개발자를 대상으로 합니다.

---

## 동작 방식

```
[내 컴퓨터들의 AI 도구]                        [내 서버 · Cairn]
 Claude Code / Codex                          ┌───────────────────────────┐
  ├ cairn-save   (넣기)   ── MCP ───────────▶│ server : API · MCP · 일꾼   │
  ├ cairn-tidy   (정리)   ── MCP ───────────▶│ web    : 그래프 · 블로그 · 관리 │
  ├ cairn-recall (읽기)   ── MCP ───────────▶│ db     : Postgres            │
  └ cairn-write  (글쓰기) ── MCP ───────────▶│                             │
                                              └───────────────────────────┘
 브라우저 (방문자 · 관리자) ── HTTPS (직접 준비한 리버스 프록시) ──▶
```

1. 작업을 마치고 AI 도구에 **"이 세션 저장해"** 라고 하면, 방금 작업한 AI가 세션 노트를 써서 서버로 보냅니다.
2. **"cairn 정리해"** 라고 하면, 내 AI 도구가 서버에 쌓인 정리 일거리를 가져가 주제를 붙이고 비슷한 세션을 연결합니다. 서버에는 AI가 없습니다.
3. 다른 컴퓨터에서 **"지난번에 이거 어떻게 풀었지?"** 라고 물으면, AI가 MCP로 과거 세션을 찾아 답합니다.
4. 세션과 사진, 참고 링크를 **글감 상자**에 담고 **"글감으로 초안 써줘"** 라고 하면, AI가 블로그 초안을 씁니다. 다듬고 발행하는 건 사람이 합니다.

---

## 핵심 원칙

1. **원본은 내 서버의 DB.** 언제든 md 파일로 내보낼 수 있고, 옵시디언에서 그대로 열립니다.
2. **들어온 정보는 버리지 않는다.** 세션은 고치지 않고 판(revision)을 쌓습니다. 여러 컴퓨터에서 동시에 올려도 잃지 않습니다.
3. **사람이 정한 것이 우선.** 내가 고친 내용과 연결은 AI가 덮지 않고, 제안으로만 바꿉니다.
4. **세션과 블로그는 서로 의존하지 않는다.** 세션이나 wiki를 지우거나 합쳐도 글은 그대로입니다. 글이 어느 wiki에서 나왔는지는 그래프에 보이지만, 비공개 내용은 드러나지 않습니다.
5. **비공개가 기본.** 세션과 첨부는 기본 비공개이고, 민감정보는 올리기 전과 받은 뒤 두 번 지웁니다.
6. **AI는 내 것을 쓴다.** 관리와 글쓰기는 내가 이미 쓰는 AI 도구가 합니다.

---

## 화면

- **그래프**: 어두운 화면 전체가 세션 그래프입니다. 방문자는 전체 모양을 보고, 공개한 세션만 열어 볼 수 있습니다. 검색하면 그 점으로 날아갑니다.
- **블로그**: 밝은 읽기 화면입니다. 카드 목록, 가운데 정렬 본문, 사진·갤러리·영상·링크 카드, 목차, 시리즈를 지원합니다.
- **관리 모드**: 승인함(AI의 제안과 충돌), 세션 편집과 공개 설정, 그래프 편집, 글 편집기, 글감 상자, 알림.

화면 프로토타입: https://claude.ai/artifact/RCcsphABtmDcgeJD6YYXSr

---

## 기술 스택

| 영역 | 선택 |
|---|---|
| 언어 | TypeScript (전 구간) |
| 서버 | NestJS + MCP TypeScript SDK |
| 화면 | Next.js |
| DB | Postgres + pg_bigm(한국어 검색) + pgvector(의미 검색) |
| ORM | Drizzle |
| 작업 큐 | Graphile Worker (Postgres만 사용, Redis 불필요) |
| 그래프 | Sigma.js + Graphology |
| 글 편집기 | CodeMirror 6 |
| 알림 | Web Push, SMTP 이메일 |
| 배포 | Docker Compose |
| 모노레포 | pnpm + Turborepo |

---

## 저장소 구조

지금 단계(M0)에 있는 것만 둡니다. 나머지 폴더는 필요해지는 단계에서 추가합니다 (최종 구조는 [MVP 기획서](docs/MVP-기획서.md) 참고).

```
cairn/
├── apps/
│   ├── server/        NestJS. 지금은 /health 하나
│   │   ├── modules.json            모듈 지도 (의존 방향, 소유 스키마)
│   │   └── src/modules/            platform(기반 클래스·DB·상태 확인) · account · vault · blog · mcp
│   │                               모듈마다 CLAUDE.md에 규칙
│   └── web/           Next.js. 지금은 서버·DB 연결 상태 화면 하나
├── db/
│   ├── Dockerfile     Postgres 17 + pgvector + pg_bigm
│   └── migrations/    SQL 마이그레이션 (dbmate)
├── docs/              기획서, MVP 기획서, 테이블 설계, 객체 설계
├── Dockerfile         앱 이미지 (server, web 공용)
├── docker-compose.yml db → migrate → server → web
├── packages/cli/      연결 명령 (cairn connect · status)
├── plugins/           플러그인 (comments-giscus: 글 아래 giscus 댓글 · sync-github: GitHub에 이력·백업 · login-github: GitHub로 로그인)
├── scripts/           모듈 경계 검사, 플러그인 화면 맞추기
├── skills/            AI 도구에 넣는 스킬 (cairn-save)
└── AGENTS.md          AI 도구 작업 규칙 (CLAUDE.md가 가져옴)
```

---

## 개발 환경

필요한 것: Docker, Node.js 24 이상, pnpm 10 (`corepack enable` 또는 `npx pnpm@10`)

```bash
cp .env.example .env
# .env의 CAIRN_SECRET_KEY= 뒤에 pnpm secret:new 결과를 붙여 넣기
docker compose up --build
```

`db`(Postgres 17 + pgvector + pg_bigm) → `migrate`(마이그레이션 적용 후 종료) → `server`(NestJS, :4000) → `web`(Next.js, :3000) 순서로 뜹니다. http://localhost:3000 에서 서버와 DB 연결 상태를 볼 수 있습니다.

| 명령 | 하는 일 |
|---|---|
| `pnpm install` | 로컬 도구(Biome, 타입 검사) 설치. 실행은 Docker에서 하므로 편집기용 |
| `pnpm check` | 린트 + 타입 검사 + 모듈 경계 검사 (CI와 같음) |
| `pnpm test` | 서버·플러그인 테스트 (단위 + API). 테스트 전용 DB를 매번 새로 만든다 |
| `pnpm install-code` | 설치 코드. 브라우저에서 `/install`을 열고 넣는다 |
| `pnpm owner reset-password` | 관리자 비밀번호 다시 정하기 (표준 입력으로. 모든 로그인이 끝남) |
| `pnpm plugin` | 플러그인 상태·켜기·설정 (예: `pnpm plugin enable sync-github`). 관리 화면이 생기면 화면에서 |
| `pnpm secret:new` | 서버 키 만들기 (`.env`의 `CAIRN_SECRET_KEY`) |
| `pnpm format` | 포맷 자동 수정 |
| `pnpm db:up` | DB만 띄우고 마이그레이션 적용 |
| `pnpm db:new <이름>` | 새 마이그레이션 파일 만들기 |
| `pnpm db:migrate` | 마이그레이션 적용 |
| `pnpm db:rollback` | 마지막 마이그레이션 되돌리기 |
| `pnpm db:reset` | DB 데이터를 지우고 처음부터 다시 |
| `pnpm db:psql` | DB에 psql로 접속 |

마이그레이션은 `db/migrations/`의 SQL 파일입니다 ([테이블 설계](docs/테이블설계.md) 참고).

---

## 설치 (예정)

> 아직 동작하지 않습니다. v0.1에서 제공할 사용 방식입니다.

**1. 서버 띄우기**

```bash
git clone https://github.com/<owner>/cairn.git
cd cairn/docker
cp .env.example .env    # 사이트 주소 입력
docker compose up -d
```

서버 로그에 나오는 **설치 코드**를 확인하고, 브라우저로 접속해 설치 마법사를 따라갑니다. 설치 코드 → 관리자 계정(아이디·비밀번호) → 블로그 정보 → 플러그인 순서입니다. 비밀번호를 잊으면 서버에서 `pnpm owner reset-password`로 다시 정합니다. HTTPS와 리버스 프록시(Caddy, Nginx Proxy Manager 등)는 직접 준비합니다. 필요한 프록시 설정은 예시로 제공할 예정입니다.

**배포할 때 지킬 것**

- **사이트 주소는 https만 됩니다.** 비밀번호·로그인 쿠키·기기 토큰이 그대로 오가지 않게 하려고, `http://192.168.x.x` 같은 주소는 받지 않습니다. 같은 컴퓨터 안에서만 쓰는 `http://localhost`는 됩니다.
  - 공개 서버: Caddy처럼 인증서를 알아서 받는 프록시를 앞에 둡니다.
  - 집 안에서만 쓸 때: Tailscale(`tailscale serve`)이나 Caddy의 내부 인증서로 https를 붙입니다.
- **밖에는 프록시만 엽니다.** 서버(4000)와 웹(3000) 포트는 밖에 열지 않습니다. 서버는 같은 컴퓨터·내부망의 프록시가 알려 주는 접속 IP만 믿기 때문에, 포트를 직접 열면 IP를 속여 시도 횟수 제한을 피할 수 있습니다.
- **프록시가 할 일**
  - http로 온 요청을 https로 돌려보냅니다.
  - `X-Forwarded-Proto`와 `X-Forwarded-For`를 서버에 넘깁니다. 없으면 로그인 쿠키에 `Secure`가 붙지 않습니다.
  - `/api` · `/mcp` · `/oauth` · `/.well-known`은 서버(4000)로, 나머지는 웹(3000)으로 보냅니다.
- **선택**
  - 프록시 접속 기록에 주소의 파라미터(`?` 뒤)를 남기지 않게 합니다.
  - 서버 디스크를 암호화합니다.

**2. 작업하는 컴퓨터 연결하기**

```bash
npx @<scope>/cairn connect https://내블로그주소            # Claude Code
npx @<scope>/cairn connect https://내블로그주소 --tool codex # Codex
```

스킬(지금은 `cairn-save`)과 검토자를 AI 도구에 넣고, MCP 서버를 등록하고, 브라우저에서 블로그에 로그인해 이 기기를 연결합니다. 그 도구의 명령줄(`claude` 또는 `codex`)이 필요합니다. `--review-with codex`처럼 다른 회사 모델을 교차 검토자로 고를 수 있습니다. npm에 올리기 전에는 저장소에서 `pnpm cairn connect …`로 실행합니다. 스킬 폴더를 직접 복사하는 방법은 관리 화면의 기기 시트에 있습니다.

**Claude 앱 · ChatGPT**(웹·데스크톱 채팅)는 명령 없이 관리 화면 → 기기에서 연결합니다. "ChatGPT·Claude 앱 연결 허용"을 켜고, 앱의 커넥터 설정에 `https://내블로그주소/mcp`를 넣은 뒤 블로그에서 승인하고, 같은 화면의 `cairn-save.zip`을 앱의 스킬에 올립니다. 앱은 그 회사 서버에서 블로그로 들어오므로 **인터넷에서 열리는 https 주소**가 필요합니다 (집 안 서버라면 Cloudflare Tunnel이나 `tailscale funnel`처럼 밖으로 여는 터널). 앱에서는 대화 원문 대조와 다른 맥락의 검토를 할 수 없어 미리보기에 "독립 검토 아님"이 붙습니다.

**3. 사용하기**

AI 도구에서 작업을 마친 뒤 **"이 세션 저장해"**.

---

## 로드맵

| 단계 | 내용 |
|---|---|
| M0 기반 | 모노레포, DB 이미지, 스키마, Docker Compose, CI |
| M1 수집 | 설치 마법사, 로그인, 기기 연결, `cairn-save` |
| M2 그래프·검색 | 그래프 화면과 편집, 공개 설정, 키워드·의미 검색 |
| M3 정리·읽기 | 일거리 상자, `cairn-tidy`, `cairn-recall`, 승인함, 충돌 합치기 |
| M4 블로그 | 글 목록·페이지, 편집기, 카테고리, 글감 상자, `cairn-write` |
| M5 알림·마감 | 알림 센터, 브라우저 푸시, 이메일, md 내보내기, v0.1 배포 |

v0.1 이후 후보: 서버에서 도는 AI(선택), 블록 편집기, 옵시디언에서 고친 md 가져오기, 매일 작업본 이메일, 일반 사용자를 위한 원클릭 배포.

---

## 문서

- [기획서](docs/기획서.md): 배경과 전체 결정 기록
- [MVP 기획서](docs/MVP-기획서.md): v0.1 범위, 화면, MCP 도구, 스택, 일정
- [테이블 설계](docs/테이블설계.md): DB 스키마와 인덱스
- [객체 설계](docs/객체설계.md): 서버 코드의 계층과 객체 규칙, 플러그인
- [보관 형식](docs/보관형식.md): 내보내기·GitHub 동기화·복원이 쓰는 파일 형식

---

## 기여

아직 개발 전이라 코드 기여는 받지 않습니다. v0.1 개발이 시작되면 기여 안내(`CONTRIBUTING.md`)를 추가하겠습니다.

## 라이선스

AGPL-3.0 (2026-10-10 결정). Cairn을 고쳐서 서비스로 운영하면 고친 코드를 공개해야 합니다.
