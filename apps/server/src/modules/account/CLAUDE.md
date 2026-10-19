# account 모듈

## 하는 일
블로그 공간과 설정, 블로그 주인(아이디·비밀번호 로그인), 연결된 기기와 권한, 로그인 토큰.
요청이 들어오면 Guard가 토큰·쿠키를 확인해 Actor(`OwnerActor` · `DeviceActor` · `VisitorActor`)를 만든다.
M1 A(설치·주인 로그인)와 B(기기 연결, MCP OAuth 2.1)까지 있다.

- `space/`: 공간 (`Space`), 설치 코드·통행증 규칙(`InstallPolicy`), `api/install`(코드 확인, 주인 계정 만들기)·`api/space`(+ `PUT api/space/hosted-apps`: ChatGPT·Claude 앱 연결 허용)
- `owner/`: 주인 (`Owner` + `WebSession` + `LoginLink`), 비밀번호 규칙(`PasswordPolicy`), `api/auth`(로그인·로그아웃·비밀번호 바꾸기)
  외부 로그인(`ExternalLoginQuery`·`ExternalLoginController`): 로그인 플러그인(`login:<이름>`)의 경로·확인값·쿠키, 계정 연결·끊기
- `device/`: 기기(`Device` + `DeviceCredential`), OAuth 클라이언트(`OAuthClient`), 승인 코드(`AuthorizationCode`), 승인 요청 규칙(`AuthorizationPolicy`).
  `OAuthController`(`/.well-known/*`, `/oauth/*`: 표준 경로라 /api 아래가 아님), `DeviceController`(`api/connect` 승인 화면, `api/devices` 기기 시트)
- `guard/`: `ActorGuard` (모든 요청: Bearer 토큰 → `DeviceActor`, 로그인 쿠키 → `OwnerActor`. 로그인 쿠키로 오는 쓰기 요청은 출처가 사이트 주소일 때만, 아니면 403 `origin`)

## 소유 데이터
스키마 `account`: spaces, users, login_links, space_members, settings, secrets, devices, oauth_clients, oauth_codes, oauth_tokens, device_tokens, web_sessions

## 데이터 묶음
- 공간: spaces + settings + secrets (블로그 이름·소개, GitHub 앱, 사이트 주소, 앱 연결 허용 `connect.hosted_apps`)
- 주인: users + space_members + web_sessions + login_links (주인은 공간마다 한 명, DB가 막는다)
- 기기: devices + device_tokens + oauth_tokens + oauth_clients + oauth_codes (M1 B)

## 공개 API (`index.ts`)
`AccountModule`(Guard 포함), 설치 코드(`InstallPolicy`)와 설치 상태(`SpaceQuery`): 명령줄·서버 시작 로그가 쓴다.
`DeviceQuery`: mcp 모듈이 401 안내 주소를 만들 때

## 내보내는 이벤트 / 받는 이벤트
`account.owner.claimed`(주인이 정해짐), `account.device.connected`, `account.device.revoked` / 없음

## 써도 되는 모듈
platform

## 지켜야 할 것
- 비밀값(GitHub client secret, SMTP 비밀번호 등)은 `secrets`에 암호화해서만 저장하고, 응답·로그에 내보내지 않는다
- 토큰(로그인·기기)은 해시만 저장한다. 원문은 만든 순간의 응답(쿠키)에만
- 주인은 공간마다 한 명 (DB 부분 유일 인덱스)
- 비밀번호는 `PasswordHasher`로 바꾼 값만. 틀렸을 때는 아이디가 없어도 같은 문구·같은 시간 (아이디가 있는지 알 수 없게)
- 외부 로그인(GitHub 등)은 코어에 두지 않는다. 로그인 플러그인이 더하고, `login_links`에 연결된 계정으로만 로그인된다
- 로그인 뒤 돌아갈 곳은 이 사이트 안의 경로만 (`LoginStartRequest`)
- 기기는 지우지 않고 `revoked_at`으로 끊는다 (다른 모듈이 기기 id를 값으로 갖고 있다). 끊으면 모든 토큰이 바로 무효
- OAuth 오류는 `OAuthError`({ error, error_description }) 모양으로. AI 도구는 이 모양만 읽는다
- 갱신 토큰은 한 번만 쓴다. 이미 쓴 것이 다시 오면 기기를 끊는다 (도난 감지)
- 사이트 주소는 https만 (`localhost` · `127.0.0.1` · `[::1]` · `*.localhost`만 http도)
- 돌려보낼 주소(redirect_uri)는 이 컴퓨터(localhost · 127.0.0.1 · [::1])와, 주인이 "앱 연결 허용"을 켰을 때만 claude.ai · chatgpt.com의 정해진 콜백 주소(`OAuthClient`의 목록). 남이 보낸 승인 링크를 눌러도 열쇠는 내 컴퓨터나 직접 켠 앱으로만 간다. 앱의 연결이면 승인 화면이 앱 이름(`ConsentView.app`)과 경고를 보인다. 승인 응답에는 `iss`(RFC 9207)
- 스스로 등록(`/oauth/register`)은 IP당 1시간 20번. 하루가 지나도록 토큰을 받지 않은 등록은 새 등록 때 지운다
- URL·쿠키에 싣는 짧은 값은 `SecretBox.pack`으로 암호화한다 (서명만 하지 않는다)

## 하지 말 것
- 다른 모듈의 테이블 접근, vault·blog import
- 비밀번호 원문을 저장·기록하기 (로그, 응답, 이벤트 모두)
