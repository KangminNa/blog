# Cairn

**내 서버 하나에서 도는 Personal AI OS. 흩어진 AI 세션을 모아 지식으로 키우고, 에이전트에게 작업을 맡겨 결재하고, 결과를 블로그로 내보내는 self-hosted 오픈소스.**

> 상태: 첫 완성(1~6단계) 구현, 배포 전. 스케줄·알림과 외부 연동은 다음 단계입니다.

## 하는 일

Claude Code나 Codex로 일하면 작업 세션이 컴퓨터마다 흩어지고 다시 열리지 않습니다. Cairn은 세션을 내 서버에 모읍니다. 세션 하나가 돌 하나라면, 쌓인 돌탑이 다음 작업의 길잡이가 됩니다.

- **"이 세션 저장해"** 라고 하면 방금 일한 AI가 세션 노트를 써서 내 서버로 보냅니다.
- 러너가 세션을 위키로 정리하고 이어서 그래프로 키웁니다. 서버 본체에는 AI가 없습니다.
- 다른 컴퓨터에서 **"전에 어떻게 했지?"** 라고 물으면 AI가 MCP로 찾아 답합니다.
- 콘솔에서 작업을 지시하면 에이전트가 하고, 위험한 동작은 결재 뒤에 실행합니다.
- 소재를 모아 초안을 맡기고, 다듬어 블로그에 공개합니다.

왜 만드는지와 원칙은 [기획서](docs/기획서.md)에 있습니다.

## 설치

필요한 것: Docker(Compose 포함), git, 도메인, RAM 2GB 이상인 서버. 서버에 Node.js·pnpm은 없어도 됩니다.

**1. 서버 띄우기**

```bash
git clone https://github.com/KangminNa/blog.git cairn
cd cairn
cp .env.example .env
```

`.env`에 아래 값을 넣습니다. 사이트 주소·플러그인은 `.env`가 아니라 설치 마법사에서 정합니다.

```ini
COMPOSE_FILE=docker-compose.prod.yml            # 운영 구성: 컴파일한 이미지, root가 아닌 사용자
DB_PASSWORD=<긴 임의 값>                         # DB를 처음 만들 때 정해져서 나중에 바꾸지 않습니다
CAIRN_SECRET_KEY=<openssl rand -base64 32 결과>  # 비밀값 암호화 키. 바꿀 때는 .env.example의 순서를 따릅니다
CAIRN_WEB_URL=https://내블로그주소               # 사람이 여는 주소
```

```bash
docker compose up -d --build
docker compose logs server | grep 설치     # 설치 코드
```

업데이트는 `git pull && docker compose up -d --build`입니다. 새 마이그레이션은 `migrate`가 적용합니다. 올린 사진은 `blob-data` 볼륨에 있으니 DB(`db-data`)와 함께 백업합니다.

**2. https 프록시 (Caddy 예시)**

DB(5432)·서버(4000)·웹(3000) 포트는 이 서버 안(127.0.0.1)에서만 열립니다. 밖에는 80·443만 열고 앞에 https 프록시를 둡니다. Caddy는 `/etc/caddy/Caddyfile`에 아래를 넣고 `sudo systemctl reload caddy`. 인증서, http → https, `X-Forwarded-*` 넘기기를 Caddy가 알아서 합니다.

```
내블로그주소 {
	@server path /api/* /mcp /oauth/* /.well-known/*
	reverse_proxy @server 127.0.0.1:4000
	reverse_proxy 127.0.0.1:3000
}
```

프록시가 Docker 컨테이너라면 서버에만 `docker-compose.override.yml`을 만들어(git에 올라가지 않음) 프록시 네트워크에 붙입니다. `proxy-net`은 프록시가 쓰는 네트워크 이름으로 바꾸고, `.env`에는 `COMPOSE_FILE=docker-compose.prod.yml:docker-compose.override.yml`처럼 함께 적습니다.

```yaml
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

**3. 설치 마법사**

`https://내블로그주소/install`을 열고 설치 코드 → 관리자 계정 → 사이트 정보 → 플러그인 → 첫 기기 순서로 진행합니다. **사이트 주소에 `https://내블로그주소`를 꼭 넣습니다.** 기기 연결과 앱 연결이 이 주소를 씁니다. 비밀번호를 잊으면 서버에서 `docker compose exec server cairn-admin owner reset-password`로 다시 정합니다 (모든 로그인이 끝남).

**배포할 때 지킬 것**

- **사이트 주소는 https만 됩니다.** `http://192.168.x.x` 같은 주소는 받지 않습니다. 같은 컴퓨터 안의 `http://localhost`는 됩니다. 집 안에서만 쓸 때는 Tailscale(`tailscale serve`)이나 Caddy의 내부 인증서로 https를 붙입니다.
- **밖에는 프록시만 엽니다.** compose의 포트를 `127.0.0.1` 밖으로 바꾸지 않습니다. Docker가 연 포트는 ufw 같은 방화벽을 거치지 않고, 포트를 직접 열면 IP를 속여 시도 횟수 제한을 피할 수 있습니다.
- **프록시가 할 일**: http를 https로 돌려보내고, `X-Forwarded-Proto`와 `X-Forwarded-For`를 넘기고(없으면 로그인 쿠키에 `Secure`가 붙지 않습니다), 10MB 본문을 받습니다.
- **선택**: 프록시 접속 기록에 주소의 파라미터(`?` 뒤)를 남기지 않고, 서버 디스크를 암호화합니다.

**4. 작업하는 컴퓨터 연결**

```bash
# 노트북에 이 저장소를 받아 pnpm install 한 뒤
pnpm cairn connect https://내블로그주소               # Claude Code
pnpm cairn connect https://내블로그주소 --tool codex  # Codex
```

스킬(`cairn-save`, `cairn-recall`)과 검토자를 AI 도구에 넣고, MCP 서버를 등록하고, 브라우저에서 로그인해 이 기기를 연결합니다. 그 도구의 명령줄(`claude` 또는 `codex`)이 필요하고, 한 컴퓨터는 블로그 하나에 연결합니다. `--review-with codex`처럼 다른 회사 모델을 교차 검토자로 고를 수 있습니다.

**Claude 앱 · ChatGPT**는 콘솔 → 기기에서 "ChatGPT·Claude 앱 연결 허용"을 켜고, 앱의 커넥터 설정에 `https://내블로그주소/mcp`를 넣은 뒤 블로그에서 승인하고, 같은 화면의 `cairn-save.zip`을 앱의 스킬에 올립니다. 앱은 그 회사 서버에서 들어오므로 **인터넷에서 열리는 https 주소**가 필요합니다. 집 안 서버라면 Cloudflare Tunnel이나 `tailscale funnel`처럼 밖으로 여는 터널을 씁니다. 앱에서는 대화 원문 대조와 다른 맥락의 검토를 할 수 없어 미리보기에 "독립 검토 아님"이 붙습니다.

**5. 러너 켜기**

정리, 초안, 작업은 러너가 합니다. 콘솔의 기기 메뉴 → 러너 추가로 토큰을 받고, 에이전트 메뉴에서 에이전트를 하나 만듭니다.

- **서버에서**: 러너는 서버와 함께 뜨고 스스로 연결합니다. 콘솔의 AI 메뉴에서 "브라우저로 로그인"(Claude · Codex 구독)을 누르면 러너가 로그인 명령을 대신 열고, 로그인 페이지에서 받은 코드를 붙여 넣으면 일합니다. 에이전트마다 AI 도구(Claude Code · Codex)를 고릅니다. 서버에 브라우저가 없어도 됩니다 (`claude setup-token`으로 만든 토큰을 직접 넣어도 됩니다).
- **내 컴퓨터에서**: `cp apps/runner/.env.example apps/runner/.env`로 값을 채우고 `pnpm runner start`.

**6. 브라우저 에이전트 (선택)**

서버 안에 브라우저(neko)를 두고, 에이전트가 등록한 사이트에서 일하게 합니다 (구조와 안전장치는 [docs/브라우저.md](docs/브라우저.md)). 에이전트는 편집까지만 하고 발행 버튼 앞에서 결재를 올립니다. **발행은 콘솔의 브라우저 화면에서 직접 누릅니다.** 브라우저가 메모리를 0.3~1GB 더 쓰니 RAM 3GB 이상을 권합니다.

화면은 콘솔(운영 › 브라우저 › 화면 열기)에서 봅니다. 서버가 브라우저의 화면을 그림으로 받아 HTTPS로 보여 주고, 누른 자리와 입력한 글자를 브라우저에 보냅니다. **UDP · 공인 IP · 앞단 프록시 설정이 필요 없습니다.**

1. `.env`에 더합니다.

```
COMPOSE_FILE=docker-compose.prod.yml:docker-compose.browser.yml
COMPOSE_PATH_SEPARATOR=:     # 파일을 :로 잇기 (Windows는 기본이 ;)
CAIRN_BROWSER_PASSWORD=아무-긴-값   # neko 자체 화면의 비밀번호 (실시간 영상을 쓸 때 들어갈 때 묻는다)
```

ARM 서버(Oracle Ampere · AWS Graviton 등)는 `.env.example`의 `CAIRN_NEKO_IMAGE` 줄도 넣습니다. 기본 이미지는 amd64뿐이라 "no match for platform"으로 빌드가 멈춥니다.

2. `docker compose up -d --build`로 다시 띄우고, 콘솔 → 플러그인에서 `browser-tabs`를 켭니다. 이미 켜 두었다면 새 확장 지점(일 맡기기 · 결재 받기)을 허락하도록 다시 켭니다.
3. 에이전트 메뉴에서 "브라우저 사용" 권한과 결재 동작 "브라우저에서 발행"을 준 에이전트를 만듭니다. "전체 읽기"와는 함께 줄 수 없습니다 (로그인된 브라우저를 쓰는 에이전트는 비공개를 읽지 않습니다).
4. 운영 → 브라우저에서 사이트(이름 · 시작 주소 · 허용 출처)를 등록하고, 화면을 열어 그 사이트에 로그인합니다. 비밀번호는 "가려서 입력"으로 보냅니다. 자동화용 계정을 따로 쓰길 권합니다.
5. 사이트에서 "일 맡기기". 결재가 오면 화면에서 직접 발행하고 결재의 "직접 발행했어요"를 누릅니다.

**실시간 영상 (선택).** 부드러운 영상(neko, WebRTC)으로 보고 싶을 때만 합니다. 영상은 Caddy를 거치지 않고 **UDP 52000**으로 바로 오므로 `.env`에 `CAIRN_PUBLIC_IP`와 `BROWSER_UDP_BIND`(서버의 공인 또는 Tailscale 주소)를 넣고, 클라우드 보안 그룹(Oracle은 서버 안 iptables도)에서 UDP 52000을 엽니다. Tailscale 주소에만 열거나 내 IP만 허용하길 권합니다. Docker가 연 포트는 ufw를 거치지 않습니다. 그리고 Caddy에 화면 경로를 더합니다. 주인 로그인을 확인한 뒤에만 넘깁니다 (`forward_auth`). 이 확인이 빠지면 로그인된 브라우저가 통째로 남에게 넘어가니 꼭 넣습니다. **아래 설정은 아직 실제 Caddy로 확인하지 않았습니다.** nginx는 `auth_request`, Traefik은 `ForwardAuth`로 같은 확인을 겁니다. 사이트 블록 안에 넣는 칸(웹 관리 도구 등)에는 `handle` 블록만 넣습니다.

```
내블로그주소 {
	handle /browser/* {
		uri strip_prefix /browser
		forward_auth 127.0.0.1:4000 {
			uri /api/p/browser-tabs/viewer
		}
		reverse_proxy 127.0.0.1:4100
	}
	@server path /api/* /mcp /oauth/* /.well-known/*
	reverse_proxy @server 127.0.0.1:4000
	reverse_proxy 127.0.0.1:3000
}
```

허용 출처는 가드레일입니다: 다른 주소로 가는 것과 페이지 안의 요청은 막지만, 허용한 사이트가 다른 곳으로 보내는 리다이렉트는 막지 못합니다.

**7. 백업**

콘솔의 사이트 메뉴에서 zip을 받거나, `sync-github` 플러그인으로 GitHub 저장소에 5분마다 맞춥니다. 서버가 고장 나면 새 Cairn에서 복원합니다 ([보관 형식](docs/보관형식.md)). 기기는 다시 연결합니다.

## 개발 환경

필요한 것: Docker, Node.js 24 이상, pnpm 10 (`corepack enable`)

```bash
pnpm install
cp .env.example .env     # CAIRN_SECRET_KEY= 뒤에 pnpm secret:new 결과를 붙여 넣기
pnpm dev                 # db → migrate → server(:4000) · worker → web(:3000)
pnpm install-code        # 설치 코드. http://localhost:3000/install 에 넣는다
```

작업을 끝내기 전에 `pnpm check`와 `pnpm test`를 돌립니다. 명령 전체와 저장소 구조는 [AGENTS.md](AGENTS.md)에 있습니다.

## 문서

- [기획서](docs/기획서.md): 무엇을 왜, 기능 범위, 화면, 그래프 형태, 개발 단계, 결정 기록
- [테이블 설계](docs/테이블설계.md): 표의 뜻과 규칙, 트랜잭션
- [객체 설계](docs/객체설계.md): 서버 코드의 계층과 객체 규칙, 플러그인, 작업과 결재
- [API 설계](docs/API설계.md): REST, MCP, 실시간, 큐
- [보관 형식](docs/보관형식.md): 내보내기·GitHub 동기화·복원이 쓰는 파일 형식
- [AGENTS.md](AGENTS.md): 저장소에서 일하는 규칙 (사람과 AI 도구 공통)

## 라이선스

AGPL-3.0. Cairn을 고쳐서 서비스로 운영하면 고친 코드를 공개해야 합니다. 아직 배포 전이라 코드 기여는 받지 않습니다.
