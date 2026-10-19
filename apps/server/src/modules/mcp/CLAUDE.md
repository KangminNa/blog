# mcp 모듈

## 하는 일
AI 도구(Claude Code, Codex 등)가 들어오는 입구. MCP 프로토콜, 도구 등록, 읽기 기록.
도구 자체(`*.tool.ts`)는 각 모듈에 있고, 여기서는 모아서 연다. 비즈니스 규칙을 두지 않는다.
`McpController`(`/mcp`, 기기 토큰이 없으면 401 + 인증 안내 주소)와 `McpToolbox`(각 모듈의 도구 모음: vault의 `check_session` · `save_session`, 서버 안내문 `INSTRUCTIONS`: 저장 순서).
`SkillController`(`api/skills/<이름>.zip`, 주인만): ChatGPT·Claude 앱에 올릴 스킬 zip. `SkillQuery`가 저장소의 `skills/<이름>/`에서 SKILL.md와 references만 읽는다 (scripts·agents 빼고, `{{SKILL_DIR}}`은 "이 스킬 폴더"로). 폴더는 `CAIRN_SKILLS_DIR`로 바꿀 수 있다
도구 응답의 링크에 쓸 사이트 주소는 `McpController`가 account에서 읽어 도구에 넘긴다 (`BaseTool.handle(actor, raw, site)`).
통신은 platform/base의 `McpEndpoint`가 한다. 인증(OAuth)과 기기는 account 모듈.

## 소유 데이터
스키마 `mcp`: mcp_reads

## 데이터 묶음
없음 (읽기 기록은 쌓기만 한다)

## 공개 API (`index.ts`)
없음. 다른 모듈이 mcp를 쓰지 않는다.

## 내보내는 이벤트 / 받는 이벤트
없음 / 없음

## 써도 되는 모듈
platform, account(인증 → Actor), vault, blog (각 모듈의 `index.ts`가 내보낸 도구만)

## 지켜야 할 것
- MCP SDK는 `platform/base` 안에서만 감싸 쓴다 (2026-10-10 결정). 이 모듈은 각 모듈의 `BaseTool`을 모아 그 입구에 등록한다
- 도구 응답의 오류는 `DomainError.toJSON()`으로 AI가 고칠 수 있게 돌려준다
- 응답에 서버 알림을 덧붙일 수 있게 응답 형식은 객체로 둔다

## 하지 말 것
- 도구 안에서 판단하기 (도구는 Request → Service·Query 하나 → Response)
- 다른 모듈의 내부 파일 import
