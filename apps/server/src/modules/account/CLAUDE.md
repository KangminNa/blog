# account 모듈

## 하는 일
블로그 공간과 설정, 블로그 주인(아이디·비밀번호 로그인), 연결된 기기와 권한, 로그인 토큰.
요청이 들어오면 Guard가 토큰·쿠키를 확인해 Actor(`OwnerActor` · `DeviceActor` · `VisitorActor`)를 만든다.
M1 A(설치·주인 로그인)까지 있다. 기기 연결은 M1 B.

- `space/`: 공간 (`Space`), 설치 코드·통행증 규칙(`InstallPolicy`), `api/install`(코드 확인, 주인 계정 만들기)·`api/space`
- `owner/`: 주인 (`Owner` + `WebSession`), 비밀번호 규칙(`PasswordPolicy`), `api/auth`(로그인·로그아웃·비밀번호 바꾸기)
- `guard/`: `ActorGuard` (모든 요청: 로그인 쿠키 → `OwnerActor`)

## 소유 데이터
스키마 `account`: spaces, users, login_links, space_members, settings, secrets, devices, oauth_clients, oauth_codes, oauth_tokens, device_tokens, web_sessions

## 데이터 묶음
- 공간: spaces + settings + secrets (블로그 이름·소개, GitHub 앱, 사이트 주소)
- 주인: users + space_members + web_sessions + login_links (주인은 공간마다 한 명, DB가 막는다)
- 기기: devices + device_tokens + oauth_tokens + oauth_clients + oauth_codes (M1 B)

## 공개 API (`index.ts`)
`AccountModule`(Guard 포함), 설치 코드(`InstallPolicy`)와 설치 상태(`SpaceQuery`): 명령줄·서버 시작 로그가 쓴다

## 내보내는 이벤트 / 받는 이벤트
`account.owner.claimed` (주인이 정해짐). 예정: `account.device.connected`, `account.device.revoked` / 없음

## 써도 되는 모듈
platform

## 지켜야 할 것
- 비밀값(GitHub client secret, SMTP 비밀번호 등)은 `secrets`에 암호화해서만 저장하고, 응답·로그에 내보내지 않는다
- 토큰(로그인·기기)은 해시만 저장한다. 원문은 만든 순간의 응답(쿠키)에만
- 주인은 공간마다 한 명 (DB 부분 유일 인덱스)
- 비밀번호는 `PasswordHasher`로 바꾼 값만. 틀렸을 때는 아이디가 없어도 같은 문구·같은 시간 (아이디가 있는지 알 수 없게)
- 외부 로그인(GitHub 등)은 코어에 두지 않는다. 로그인 플러그인이 더하고, `login_links`에 연결된 계정으로만 로그인된다
- 로그인 뒤 돌아갈 곳은 이 사이트 안의 경로만 (`LoginStartRequest`)
- 기기는 지우지 않고 `revoked_at`으로 끊는다 (다른 모듈이 기기 id를 값으로 갖고 있다)

## 하지 말 것
- 다른 모듈의 테이블 접근, vault·blog import
- 비밀번호 원문을 저장·기록하기 (로그, 응답, 이벤트 모두)
