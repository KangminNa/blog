# 도구별 차이

cairn-save는 어느 AI 도구에서나 같은 순서로 돈다. 도구마다 다른 것만 여기 모은다.

| 도구 | 모드 | `tool` 값 | 대화 id | 근거 묶음 | 검토자 |
|---|---|---|---|---|---|
| Claude Code | 로컬 | `claude-code` | `context.mjs`가 알려 줌 | 대화 원문 + git | 하위 에이전트 `cairn-fact-reviewer` · `cairn-boundary-reviewer` |
| Codex | 로컬 | `codex` | `context.mjs`가 알려 줌 | 대화 원문 + git | 하위 에이전트 `cairn_fact_reviewer` · `cairn_boundary_reviewer` |
| Gemini CLI 등 | 로컬 | 도구 이름 (영문 소문자) | `check_session`이 만들어 줌 | git + 작성자가 옮겨 적음 | `review.mjs` 또는 직접 |
| ChatGPT | 앱 | `chatgpt` | `check_session`이 만들어 줌 | 작성자가 대화에서 옮겨 적음 | 직접 ("독립 검토 아님") |
| Claude 앱 (웹·데스크톱) | 앱 | `claude` | `check_session`이 만들어 줌 | 작성자가 대화에서 옮겨 적음 | 직접 ("독립 검토 아님") |

## 모드

- **로컬 모드:** 셸 명령을 실행할 수 있고 이 스킬 폴더의 `scripts/`가 있다. 스크립트로 근거 묶음을 만들고, 인용을 원문과 대조하고, 다른 AI 명령줄로 교차 검토할 수 있다.
- **앱 모드:** 셸이 없거나 이 컴퓨터가 아니다. 기계 검사는 `check_session`만 쓰고, 근거 묶음은 작성자가 대화에서 옮겨 적는다 (사용자 메시지는 글자 그대로).

## 대화 id

같은 대화를 다시 저장하면 같은 세션에 새 판으로 쌓인다. 그래서 같은 대화에서는 늘 같은 대화 id를 쓴다.
- `context.mjs`의 `session_id`가 있으면 그것을 `check_session`에 `source_session_id`로 넘긴다.
- 없으면 `check_session`을 대화 id 없이 부르고, 받은 `source_session_id`를 이 대화의 다음 저장에도 그대로 쓴다.

## 검토자를 띄우는 방법 (위에서부터 되는 것)

1. **하위 에이전트:** 이 대화를 모르는 새 맥락. Claude Code와 Codex는 `cairn connect`가 검토자를 넣어 둔다.
2. **다른 AI 명령줄:** `node {{SKILL_DIR}}/scripts/review.mjs <작업 폴더> fact` (또는 `boundary`). `cairn connect --review-with codex`처럼 고른 명령줄로, 다른 회사 모델이 검토할 수도 있다 (교차 검토).
3. **직접:** 위가 둘 다 안 되면 이 대화의 생각은 내려놓고 지시문 · 근거 묶음 · 초안만 보고 검토한다. 미리보기에 "독립 검토 아님"을 적는다.
