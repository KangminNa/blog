# mcp 모듈

## 하는 일
AI 도구(Claude Code, Codex 등)가 들어오는 입구. MCP 프로토콜, 도구 등록, 도구의 글.
도구 자체(`*.tool.ts`)는 각 모듈에 있고, 여기서는 모아서 연다. 비즈니스 규칙을 두지 않는다.
`McpController`(`/mcp`, 기기 토큰이나 살아 있는 작업의 작업 토큰이 없으면 401 + 인증 안내 주소. 작업 토큰은 호출마다 `TaskQuery.isLive`로 묻는다)와 `McpToolbox`(각 모듈의 도구 모음: 모듈별 목록 `vault-tools.ts` · `blog-tools.ts` · `task-tools.ts`를 모은다, 서버 안내문 `INSTRUCTIONS`: 저장 순서, 글은 `mcp.instructions.ko.json`).
도구의 설명 · 칸 설명의 기본 글은 모듈의 설명서(`<모듈>.tools.ko.json`, 목록 클래스의 `texts`)를 `McpToolbox`가 합친 것(`ToolTexts`, `defaultText`)이고, 기능 패키지의 도구는 목록 파일의 글이다. 시작할 때 설명서가 코드와 맞는지 보고, 맞지 않으면 서버가 뜨지 않는다.
`tool-text/`: 도구 설명 (`ToolText`, 2차 1-0). 주인이 콘솔 "도구 설명"(`api/tool-texts`)에서 기본 글 위에 판을 쌓고 되돌린다 (스킬 메뉴와 같은 모양). `tools/list`는 `ToolTextQuery.describe`가 요청자 공간의 지금 판을 기본 글에 얹어 낸다 (`McpEndpoint`의 describe, 요청마다 쿼리 하나). 글만 바뀌고 이름 · 권한 · 입력 형식 · 길이는 코드의 것이다
`SkillController`(`api/skills/<이름>.zip`, 주인만): ChatGPT·Claude 앱에 올릴 스킬 zip. `SkillQuery`가 저장소의 `skills/<이름>/`에서 SKILL.md와 references만 읽는다 (scripts·agents 빼고, `{{SKILL_DIR}}`은 "이 스킬 폴더"로).
도구 응답의 링크에 쓸 사이트 주소는 `McpController`가 account에서 읽어 도구에 넘긴다 (`BaseTool.handle(actor, raw, site)`).
통신은 platform/base의 `McpEndpoint`가 한다. 인증(OAuth)과 기기는 account 모듈.

## 소유 데이터
스키마 `mcp`: tool_texts, tool_text_revisions(추가만)

## 데이터 묶음
- 도구 설명: tool_texts + tool_text_revisions (공간 · 도구마다 한 줄, 지금 쓰는 판 `active_revision`, 비면 기본 글)

## 공개 API (`index.ts`)
없음. 다른 모듈이 mcp를 쓰지 않는다.

## 내보내는 이벤트 / 받는 이벤트
없음 / 없음

## 써도 되는 모듈
platform, account(인증 → Actor), vault, blog, task (각 모듈의 `index.ts`가 내보낸 도구만. task는 작업 토큰 확인도)

## 지켜야 할 것
- MCP SDK는 `platform/base` 안에서만 감싸 쓴다 (객체설계 10장). 이 모듈은 각 모듈의 `BaseTool`을 모아 그 입구에 등록한다
- 도구 응답의 오류는 `DomainError.toJSON()`으로 AI가 고칠 수 있게 돌려준다
- 응답에 서버 알림을 덧붙일 수 있게 응답 형식은 객체로 둔다
- 도구 설명은 주인만 고친다 (write 기기도 안 된다: AI에게 주는 글이다). 지금 열린 도구(코어 + 동작 중인 기능 패키지)만, 그 도구에 있는 칸만. 판은 추가만 (트리거)

## 하지 말 것
- 도구 안에서 판단하기 (도구는 Input → Service·Query 하나 → View)
- 다른 모듈의 내부 파일 import
