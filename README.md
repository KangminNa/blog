# Cairn

**내 서버 하나에서 도는 Personal AI OS. 흩어진 AI 세션을 모아 지식으로 키우고, 에이전트에게 작업을 맡겨 결재하고, 결과를 블로그로 내보내는 self-hosted 오픈소스.**

> 상태: **콘솔 구조까지 구현.** 설치·로그인, 기기 연결(Claude Code · Codex · Claude 앱 · ChatGPT), 세션 저장, 블로그 글 쓰기(초안·공개·링크 공개), 관리 콘솔이 동작합니다. 작업과 결재, 그래프는 만드는 중입니다. 서버에는 아래 "운영 환경으로 올리기"대로 운영 이미지를 씁니다.

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
| **맡긴다** | 콘솔에서 작업을 지시하면 에이전트가 수행하고, 발행·전송·삭제는 결재 뒤에 실행합니다 (만드는 중) |

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
  ├ cairn-tidy   (정리)   ── MCP ───────────▶│ web    : 블로그 · 콘솔       │
  ├ cairn-recall (읽기)   ── MCP ───────────▶│ db     : Postgres            │
  └ cairn-write  (글쓰기) ── MCP ───────────▶│ runner : AI 작업 실행 (선택)  │
                                              └───────────────────────────┘
 브라우저 (방문자 · 관리자) ── HTTPS (직접 준비한 리버스 프록시) ──▶
```

1. 작업을 마치고 AI 도구에 **"이 세션 저장해"** 라고 하면, 방금 작업한 AI가 세션 노트를 써서 서버로 보냅니다.
2. **"cairn 정리해"** 라고 하면, 내 AI 도구나 러너가 서버에 쌓인 정리 일거리를 가져가 주제를 붙이고 비슷한 세션을 연결합니다. 서버 본체에는 AI가 없습니다.
3. 다른 컴퓨터에서 **"지난번에 이거 어떻게 풀었지?"** 라고 물으면, AI가 MCP로 과거 세션을 찾아 답합니다.
4. 세션과 사진, 참고 링크를 **소재**에 담고 **"소재로 초안 써줘"** 라고 하면, AI가 블로그 초안을 씁니다. 발행은 결재를 거칩니다.

---

## 핵심 원칙

1. **원본은 내 서버의 DB.** 언제든 md 파일로 내보낼 수 있고, 옵시디언에서 그대로 열립니다.
2. **들어온 정보는 버리지 않는다.** 세션은 고치지 않고 판(revision)을 쌓습니다. 여러 컴퓨터에서 동시에 올려도 잃지 않습니다.
3. **사람이 정한 것이 우선.** 내가 고친 내용과 연결은 AI가 덮지 않고, 제안으로만 바꿉니다.
4. **세션과 블로그는 서로 의존하지 않는다.** 세션이나 wiki를 지우거나 합쳐도 글은 그대로입니다. 글이 어느 wiki에서 나왔는지는 그래프에 보이지만, 비공개 내용은 드러나지 않습니다.
5. **비공개가 기본.** 세션과 첨부는 기본 비공개이고, 민감정보는 올리기 전과 받은 뒤 두 번 지웁니다.
6. **AI는 내 것을 쓴다.** 서버 본체에는 AI가 없고, 내 AI 도구나 러너가 일을 빌려 가서 합니다.
7. **위험한 동작은 결재 뒤에.** 발행, 전송, 삭제는 AI가 직접 하지 못합니다.

---

## 화면

화이트와 블랙 두 테마를 쓰고, 기기 설정을 따르거나 직접 고를 수 있습니다.

- **블로그** (`/`): 글 목록과 글 페이지. 공개 그래프는 만드는 중입니다.
- **콘솔** (`/admin`): 왼쪽 메뉴로 세션, 글, 기기, 플러그인, 사이트, 계정을 관리합니다. 작업, 결재, 에이전트, 그래프, 위키 메뉴는 기능과 함께 늘어납니다.

화면 시안: https://claude.ai/artifact/LgbcWrhsaVZJjAS9MjE5gA

---

## 기술 스택

| 영역 | 선택 |
|---|---|
| 언어 | TypeScript (전 구간) |
| 서버 | NestJS + MCP TypeScript SDK |
| 화면 | Next.js |
| DB | Postgres + pg_bigm(한국어 검색) + pgvector(의미 검색) |
| DB 접근 | postgres.js로 SQL 직접 작성 (ORM 없음) |
| 작업 큐 | Postgres outbox와 `FOR UPDATE SKIP LOCKED` (Redis 없음) |
| 그래프 | Canvas 물리 그래프 (만드는 중) |
| 글 편집기 | Tiptap (저장은 md) |
| 알림 | Web Push, SMTP 이메일 |
| 배포 | Docker Compose |
| 모노레포 | pnpm |

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
| `pnpm secret:rotate` | 서버 키를 바꾼 뒤 비밀값을 새 키로 다시 암호화 (순서는 `.env.example`) |
| `pnpm format` | 포맷 자동 수정 |
| `pnpm db:up` | DB만 띄우고 마이그레이션 적용 |
| `pnpm db:new <이름>` | 새 마이그레이션 파일 만들기 |
| `pnpm db:migrate` | 마이그레이션 적용 |
| `pnpm db:rollback` | 마지막 마이그레이션 되돌리기 |
| `pnpm db:reset` | DB 데이터를 지우고 처음부터 다시 |
| `pnpm db:psql` | DB에 psql로 접속 |

마이그레이션은 `db/migrations/`의 SQL 파일입니다 ([테이블 설계](docs/테이블설계.md) 참고).

---

## 설치

> 아래는 개발 구성(코드 감시 모드)입니다. 서버에 올릴 때는 이어지는 "운영 환경으로 올리기"를 함께 따릅니다.
> 화면을 처음 열 때 느리고 메모리를 많이 써서 RAM 2GB 이상인 서버를 권합니다.

**1. 서버 띄우기**

필요한 것: Docker(Compose 포함), git, 도메인. 서버에 Node.js·pnpm은 없어도 됩니다.

```bash
git clone https://github.com/KangminNa/blog.git cairn
cd cairn
cp .env.example .env
```

`.env`에서 세 값을 정합니다. 블로그 이름·사이트 주소·플러그인은 `.env`가 아니라 설치 마법사에서 정합니다.

```ini
DB_PASSWORD=<긴 임의 값>                     # DB를 처음 만들 때 정해져서 나중에 바꾸지 않습니다
CAIRN_SECRET_KEY=<openssl rand -base64 32 결과>  # 비밀값 암호화 키. 바꿀 때는 .env.example의 순서를 따릅니다
CAIRN_WEB_URL=https://내블로그주소              # 꼭 넣기: 없으면 화면의 버튼이 동작하지 않습니다 (개발 모드 웹)
COMPOSE_FILE=docker-compose.prod.yml           # 운영 환경으로 올리기. 설명은 아래
```

```bash
docker compose up -d --build
docker compose logs server | grep 설치     # 설치 코드
```

업데이트는 `git pull && docker compose up -d --build`입니다. 새 마이그레이션은 `migrate`가 적용합니다.

**운영 환경으로 올리기**

`COMPOSE_FILE=docker-compose.prod.yml`이 있으면 `docker compose` 명령이 모두 운영 구성을 씁니다. 컴파일한 이미지를 root가 아닌 사용자로 돌리고, 소스 마운트와 감시 모드가 없습니다.
프로젝트 이름과 볼륨이 개발 구성과 같아서, 개발 구성으로 돌리던 서버에 이 줄을 넣고 다시 올려도 DB를 그대로 이어 씁니다.
아래의 `docker-compose.override.yml`을 쓰면 `COMPOSE_FILE=docker-compose.prod.yml:docker-compose.override.yml`처럼 함께 적습니다. 파일을 직접 고르면 저절로 합쳐지지 않습니다.

**2. https 프록시 (Caddy 예시)**

DB(5432)·서버(4000)·웹(3000) 포트는 이 서버 안(127.0.0.1)에서만 열립니다. 밖에는 80·443만 열고 앞에 https 프록시를 둡니다.
Caddy를 서버에 직접 설치했다면 `/etc/caddy/Caddyfile`에 아래를 넣고 `sudo systemctl reload caddy`. 인증서 받기, http → https, `X-Forwarded-Proto`·`X-Forwarded-For` 넘기기를 Caddy가 알아서 합니다.

```
내블로그주소 {
	@server path /api/* /mcp /oauth/* /.well-known/*
	reverse_proxy @server 127.0.0.1:4000
	reverse_proxy 127.0.0.1:3000
}
```

프록시가 Docker 컨테이너라면 포트 대신 그 프록시의 네트워크에 붙입니다. 서버에만 `docker-compose.override.yml`을 만들면(git에 올라가지 않음) `docker compose`가 알아서 합쳐 읽습니다. 아래의 `proxy-net`은 프록시가 쓰는 네트워크 이름으로 바꿉니다.

```yaml
# docker-compose.override.yml
services:
  server:
    networks:
      proxy-net:
        aliases: [cairn-server]
  web:
    networks:
      proxy-net:
        aliases: [cairn-web]

networks:
  proxy-net:
    external: true
```

프록시에서는 `/api` · `/mcp` · `/oauth` · `/.well-known`을 `cairn-server:4000`으로, 나머지를 `cairn-web:3000`으로 보냅니다.
Cairn의 컨테이너끼리는 `cairn-` 이 붙은 이름으로 부르기 때문에, 같은 네트워크에 다른 프로젝트의 `db` · `server`가 있어도 섞이지 않습니다.

**3. 설치 마법사**

`https://내블로그주소/install`을 열고 설치 코드 → 관리자 계정(아이디·비밀번호) → 블로그 정보 → 플러그인 순서로 진행합니다.
**블로그 정보의 사이트 주소에 `https://내블로그주소`를 꼭 넣습니다.** 기기 연결과 앱 연결이 이 주소를 씁니다.
비밀번호를 잊으면 서버에서 `docker compose exec server cairn-admin owner reset-password`로 다시 정합니다 (모든 로그인이 끝남).

**배포할 때 지킬 것**

- **사이트 주소는 https만 됩니다.** 비밀번호·로그인 쿠키·기기 토큰이 그대로 오가지 않게 하려고, `http://192.168.x.x` 같은 주소는 받지 않습니다. 같은 컴퓨터 안에서만 쓰는 `http://localhost`는 됩니다.
  - 공개 서버: Caddy처럼 인증서를 알아서 받는 프록시를 앞에 둡니다.
  - 집 안에서만 쓸 때: Tailscale(`tailscale serve`)이나 Caddy의 내부 인증서로 https를 붙입니다.
- **밖에는 프록시만 엽니다.** `docker-compose.yml`의 포트를 `127.0.0.1` 밖으로 바꾸지 않습니다. Docker가 연 포트는 ufw 같은 방화벽을 거치지 않습니다. 서버는 같은 컴퓨터·내부망의 프록시가 알려 주는 접속 IP만 믿기 때문에, 포트를 직접 열면 IP를 속여 시도 횟수 제한을 피할 수 있습니다.
- **프록시가 할 일**
  - http로 온 요청을 https로 돌려보냅니다.
  - `X-Forwarded-Proto`와 `X-Forwarded-For`를 서버에 넘깁니다. 없으면 로그인 쿠키에 `Secure`가 붙지 않습니다.
  - `/api` · `/mcp` · `/oauth` · `/.well-known`은 서버(4000)로, 나머지는 웹(3000)으로 보냅니다.
- **선택**
  - 프록시 접속 기록에 주소의 파라미터(`?` 뒤)를 남기지 않게 합니다.
  - 서버 디스크를 암호화합니다.

**4. 작업하는 컴퓨터 연결하기**

```bash
# 노트북에 이 저장소를 받아 pnpm install 한 뒤
pnpm cairn connect https://내블로그주소               # Claude Code
pnpm cairn connect https://내블로그주소 --tool codex  # Codex
```

스킬(지금은 `cairn-save`)과 검토자를 AI 도구에 넣고, MCP 서버를 등록하고, 브라우저에서 블로그에 로그인해 이 기기를 연결합니다. 그 도구의 명령줄(`claude` 또는 `codex`)이 필요합니다. `--review-with codex`처럼 다른 회사 모델을 교차 검토자로 고를 수 있습니다. npm에 올린 뒤(v0.1)에는 `npx`로 바로 실행합니다. 스킬 폴더를 직접 복사하는 방법은 관리 화면의 기기 시트에 있습니다.

**Claude 앱 · ChatGPT**(웹·데스크톱 채팅)는 명령 없이 콘솔 → 기기에서 연결합니다. "ChatGPT·Claude 앱 연결 허용"을 켜고, 앱의 커넥터 설정에 `https://내블로그주소/mcp`를 넣은 뒤 블로그에서 승인하고, 같은 화면의 `cairn-save.zip`을 앱의 스킬에 올립니다. 앱은 그 회사 서버에서 블로그로 들어오므로 **인터넷에서 열리는 https 주소**가 필요합니다 (집 안 서버라면 Cloudflare Tunnel이나 `tailscale funnel`처럼 밖으로 여는 터널). 앱에서는 대화 원문 대조와 다른 맥락의 검토를 할 수 없어 미리보기에 "독립 검토 아님"이 붙습니다.

**5. 사용하기**

AI 도구에서 작업을 마친 뒤 **"이 세션 저장해"**.

---

## 로드맵

| 단계 | 내용 |
|---|---|
| 끝남 | 기반, 세션 수집, 글 쓰기, 콘솔 구조 |
| 2 서버 보안 | 운영 이미지, root가 아닌 실행, 서버 키 교체 |
| 3 작업·로컬 러너 | 작업, 결재, 에이전트, 실행 로그, 오피스 |
| 4 서버 러너 | 러너 컨테이너, AI 연결 |
| 5 블로그 자동화 | `cairn-write`, 소재, 사진, RSS |
| 6 세션 정리·그래프 | `cairn-tidy`, `cairn-recall`, 위키, 그래프, 검색 |
| 7 스케줄·알림 | 스케줄, 사용 한도, 브라우저 푸시 |
| 8 연동·SNS | Slack, Gmail, Telegram, X, Threads |

1~6단계가 첫 완성입니다. 그다음 후보: 의미 검색, 콘솔 대화창, 웹뷰 앱, 옵시디언에서 고친 md 가져오기.

---

## 문서

- [기획서](docs/기획서.md): 배경과 전체 결정 기록
- [MVP 기획서](docs/MVP-기획서.md): v0.1 범위, 화면, MCP 도구, 스택, 일정
- [테이블 설계](docs/테이블설계.md): DB 스키마와 인덱스
- [객체 설계](docs/객체설계.md): 서버 코드의 계층과 객체 규칙, 플러그인
- [API 설계](docs/API설계.md): REST, MCP, 실시간, 큐 규칙
- [보관 형식](docs/보관형식.md): 내보내기·GitHub 동기화·복원이 쓰는 파일 형식

---

## 기여

아직 개발 전이라 코드 기여는 받지 않습니다. v0.1 개발이 시작되면 기여 안내(`CONTRIBUTING.md`)를 추가하겠습니다.

## 라이선스

AGPL-3.0 (2026-10-10 결정). Cairn을 고쳐서 서비스로 운영하면 고친 코드를 공개해야 합니다.
