# 플러그인

코어가 몰라도 되는 기능은 플러그인으로 만든다 (기획서 결정 기록 2026-10-10, 객체설계 12장).
지금 있는 플러그인: `comments-giscus`(글 아래 giscus 댓글), `sync-github`(보관 형식을 GitHub에 동기화), `login-github`(GitHub 계정으로 로그인).

## 폴더 하나 = 플러그인 하나

```
plugins/<이름>/
  cairn-plugin.json     목록 파일. 여기에 적은 것만 쓸 수 있다
  web/<화면>.tsx         웹 화면 자리에 들어갈 화면 (있을 때만)
  server/plugin.ts      서버 코드 (있을 때만). BasePlugin을 상속한 클래스를 default로
  server/*.test.ts      테스트 (pnpm test가 함께 돌림)
```

## 목록 파일

- `name`: 폴더 이름과 같아야 한다. 소문자·숫자·하이픈
- `version`: 1.2.3, `cairn`: 지원하는 플러그인 API 범위 (지금은 `">=0.1"`)
- `settings`: 설정 항목. `label`, `type`(`text`·`secret`·`select`·`boolean`), `required`, `help`, `default`, `options`(select), `public`.
  설치 마법사·관리 화면의 칸이 이것으로 만들어진다. 값은 DB(`platform.plugin_settings`)에 저장되고, `secret`은 서버 키로 암호화된다.
  `public: true`인 값만 웹으로 내려간다 (비밀값은 공개할 수 없다)
- `web`: 화면 자리 → 파일. 지금 자리는 `post.after`(글 아래) 하나
- `server`, `uses`: 서버 코드와 쓰는 확장 지점 (`event:<무늬>`, `job:<이름>`, `action:<이름>`, `archive:read`, `login:<이름>`). 객체설계 12장

## 켜기·설정

설치 마법사와 관리 화면(설정 → 플러그인)에서 켜고, 쓰는 권한을 확인하고, 설정 칸을 채운다. 화면이 생기기 전에는 명령줄:

```
pnpm plugin                                   들어 있는 플러그인과 상태
pnpm plugin enable sync-github                켜기 (쓰는 권한을 보여주고 허락)
pnpm plugin set sync-github repo me/archive   값 넣기
echo -n "<토큰>" | pnpm plugin set sync-github token   비밀값은 표준 입력으로
pnpm plugin sync-github check                 관리 동작
```

- `.env`에는 플러그인 설정을 두지 않는다. 서버 키(`CAIRN_SECRET_KEY`, `pnpm secret:new`)만 둔다.
- 켜고 끄거나 설정을 바꾸면 재시작 없이 반영된다 (`platform.plugin.changed` 이벤트 → 일꾼이 다시 등록, 서버는 매번 DB에서 읽음).
- 웹은 들어 있는 플러그인 화면을 모두 넣어 두고, 켜진 것만 그린다.
- **새 플러그인 폴더를 넣었을 때만** 서버·일꾼·웹을 다시 시작한다 (들어 있는 플러그인 목록은 시작할 때 읽는다).
- 새 버전이 확장 지점을 더 쓰면, 다시 켜서 허락하기 전까지 그 플러그인은 동작하지 않는다.

## 지켜야 할 것

- 웹 화면은 `react`와 자기 폴더 안의 파일만, 서버 코드는 `node:*`와 `apps/server/src/plugin-api`만 import한다 (`pnpm check`가 막는다)
- 외부 서비스 호출은 `BaseGateway`를 상속한 클래스 하나에 모은다. 테스트는 가짜 서버로 (예: `sync-github/server/fake-github.ts`)
- 화면이 받는 값은 `settings`(공개 설정)와 `context`(자리마다 정해진 값, `post.after`는 글 id·주소·제목)뿐이다
- 설정이 비어 있으면 방문자에게는 아무것도 보이지 않게 한다 (`context.preview`일 때만 안내)
- 로그인 플러그인은 "누구인지"만 알려준다. 주인인지는 코어가 정하므로, 주인이 계정 시트에서 연결한 계정으로만 로그인된다
- API 경로·MCP 도구·자기 스키마는 아직 없다. 필요한 플러그인이 생길 때 확장 지점을 먼저 제안하고 만든다
