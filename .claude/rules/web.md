---
paths:
  - "apps/web/**"
  - "plugins/*/web/**"
---

# 웹 코드 규칙

구조와 패턴은 [docs/객체설계.md](../../docs/객체설계.md) 6장 "콘솔 메뉴 하나의 구조"와 11장 "패턴 목록". 새 화면은 패턴의 본보기에서 시작한다.
`pnpm check`의 규칙 검사(`scripts/check-rules.mjs`)가 아래 ★ 표시를 지킨다.

| 파일 | 해도 되는 것 | 하면 안 되는 것 |
|---|---|---|
| `page.tsx` | 서버에서 그린다. 주소의 값 읽기, 첫 데이터가 꼭 필요할 때만 `serverGet`, 패널에 넘기기 | 상태, 버튼 처리, `'use client'` |
| `<이름>Panel.tsx` | 화면 하나. 읽기는 `useLiveValue`(나 그 위의 `_<모듈>/live.ts` 훅), 쓰기는 `useAction`. 폼의 저장도 패널이 돌린다 | ★ 불러오기를 손으로 쓰기(`useEffect` + GET), ★ `busy` · `problem` 상태를 손으로 만들기 |
| `<이름>Form.tsx` | 입력 칸의 상태, 보낼 본문 만들기 → `onSubmit(본문)`. 처음 값과 `busy` · `problem`은 props로 받고, 값이 바뀌면 패널이 `key`로 폼을 새로 만든다 | API 호출, `useAction`, 읽은 값으로 칸을 다시 채우는 `useEffect` |
| `_<모듈>/types.ts` | 서버 view에서 `import type`으로 만든 타입 (`ReturnType<XxxView['toJSON']>`) | ★ 응답 모양을 손으로 적기 (`api<{ … }>`도) |
| `_<모듈>/live.ts` | 여러 화면이 함께 쓰는 읽기 훅과 변경 신호의 주제 | 쓰기 |
| `_<모듈>/labels.ts` | 값 → 화면 문구 | 화면 조각 |
| `_lib/` | API 호출(`api` · `serverGet`), 공용 훅(`useLiveValue` · `useAction`) | 한 메뉴만 쓰는 것 |
| `_ui/` | 두 곳 이상에서 쓰는 화면 부품 | 한 메뉴만 쓰는 부품, 데이터 읽기 |

## 읽기와 쓰기

- 읽기: `useLiveValue(key, read, topics)`. 처음 한 번, 서버의 변경 신호가 올 때, 다시 연결될 때 읽는다. 다시 읽는 동안에도 앞의 값을 보여 준다 (오류와 값을 따로 그린다).
- 쓰기: `const action = useAction()` → `action.run(이름, () => api(…), { done, reload, conflict })`. 바쁨(`action.busy`) · 오류 문구(`action.problem`) · 아래 알림 · 다시 읽기 · 409 처리를 한 곳에서 한다. 줄마다 버튼이 있으면 이름에 그 줄의 id를 준다.
- 409는 다시 읽고 서버의 문구를 보여 준다. 본 `version`이 낡은 경우에만 `conflict`로 화면의 말을 준다 (서버 문구에는 판 번호가 있다). 이름이 겹침처럼 409가 다른 뜻이면 주지 않는다.
- 훅 하나는 한 번에 동작 하나만 돌린다. 함께 돌 수 있거나 오류를 다른 자리에 보여 줄 동작은 `useAction()`을 따로 둔다.
- 동작(`useAction`)은 다시 만들어지지 않는 쪽(패널)에 둔다. 폼 안에 두면 409 뒤에 다시 읽어 폼이 새로 만들어질 때 오류 문구가 함께 사라진다.
- 오류 문구는 `describe(error)`로만 만든다. 서버 오류의 `message`를 화면에서 다시 조립하지 않는다.
- 만들기는 `requestId`를 함께 보낸다 (응답을 못 받아 다시 눌러도 하나만 생기게). 고치기는 본 `version`을 함께 보낸다.

## 서버와 함께 쓰는 것

- ★ 서버 코드는 `import type`으로만 가져온다. 값(클래스 · 상수)을 가져오면 서버 코드가 브라우저 묶음에 들어간다.
- 서버 응답이 바뀌면 같은 변경에서 화면도 고친다. 순서는 표(마이그레이션) → 서버(input · view) → 웹(types · 화면).
- 웹은 DB에 닿지 않고 서버 API만 부른다.

## 모양

- 색 · 간격 토큰은 `globals.css`에만 둔다. 화면 코드에 색 값을 직접 적지 않는다. 강조색 없이 채움 · 테두리 · 굵기로 구분한다.
- 버튼 · 칸 · 목록은 `globals.css`의 클래스(`cta` · `ghost` · `field` · `input` · `list` · `panel` · `note` · `error`)를 쓴다. 같은 조각을 두 메뉴가 쓰게 되면 `_ui/`로 올린다.
- 화면 문구는 주어 없이 짧게, 한국어로 (AGENTS.md 코드 규칙).
- 같은 동작은 어느 화면에서든 같은 말로: 추가 · 편집 · 삭제(휴지통이 없는 것) · 휴지통으로 · 복원 · 연결 해제 · 승인/수정 요청/반려 · 맡기기. 판(revision)은 화면에서 "버전". "주인"은 쓰지 않는다: 관리자의 표시 이름(`useMe().data?.name`), 이름을 모르는 곳은 "관리자" (기획서 결정 2026-11-14)

## 크기와 이름

- ★ 파일 하나의 코드는 300줄까지 (빈 줄 · 주석 제외). 넘으면 개념 단위로 나눈다: 패널(읽기 · 틀)과 폼(칸), 그리는 조각.
- 플러그인 화면(`plugins/*/web`)은 react와 자기 폴더만 가져올 수 있어 공용 훅을 쓰지 못한다 (서버는 props의 `call`로 부른다).
- 이미 넘는 파일과 훅으로 옮기지 못한 화면은 `scripts/ratchet.json`에 있다 (남은 까닭은 `why`). 이 목록은 줄어들기만 한다: 새 항목을 더하지 않고, 고친 파일은 `node scripts/check-rules.mjs --update`로 지운다.
- `helpers` · `utils` · `common` · `misc` 같은 이름을 쓰지 않는다. 그 파일이 다루는 것의 이름을 붙인다.
- 안 쓰는 export · 파일은 `pnpm deadcode`(`pnpm check`에 들어 있다)가 막는다.
