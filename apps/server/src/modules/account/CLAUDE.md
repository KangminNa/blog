# account 모듈

## 하는 일
블로그 공간과 설정, 블로그 주인(GitHub 로그인), 연결된 기기와 권한, 로그인 토큰.
요청이 들어오면 Guard가 토큰·쿠키를 확인해 Actor(`OwnerActor` · `DeviceActor` · `VisitorActor`)를 만든다.
아직 코드 없음 (M1의 설치 마법사·GitHub 로그인·기기 연결에서 만든다).

## 소유 데이터
스키마 `account`: spaces, users, space_members, settings, secrets, devices, oauth_clients, oauth_codes, oauth_tokens, device_tokens, web_sessions

## 데이터 묶음
- 공간: spaces + settings + secrets
- 기기: devices + device_tokens + oauth_tokens

## 공개 API (`index.ts`)
아직 없음. 예정: Guard(요청 → Actor), 블로그 정보 Query

## 내보내는 이벤트 / 받는 이벤트
예정: `account.device.connected`, `account.device.revoked` / 없음

## 써도 되는 모듈
platform

## 지켜야 할 것
- 비밀값(GitHub client secret, SMTP 비밀번호 등)은 `secrets`에 암호화해서만 저장하고, 응답·로그에 내보내지 않는다
- 토큰은 해시만 저장한다
- 기기는 지우지 않고 `revoked_at`으로 끊는다 (다른 모듈이 기기 id를 값으로 갖고 있다)

## 하지 말 것
- 다른 모듈의 테이블 접근, vault·blog import
- GitHub 비밀번호를 받거나 저장하기
