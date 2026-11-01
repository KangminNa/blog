# 가져온 코드

이 폴더는 [Pixel Agents](https://github.com/pablodelucca/pixel-agents)의 화면 코드다. MIT, 저작권 표시는 `LICENSE`.

- 가져온 커밋: `b1bafd02896d90d83457266575a1e8e5011ce997` (2026-10-16, v1.5.0)
- 가져온 것: `webview-ui/src/office`의 `engine`·`sprites`·`layout`과 그것이 쓰는 `types`·`colorize`·`floorTiles`·`wallTiles`·`projection`·`toolUtils`,
  `webview-ui/src/constants.ts`, `webview-ui/src/components/ui/types.ts`(`colorValue.ts`), `core/src/paletteUtils.ts`
- `messages.ts`·`transport.ts`: `core/src/messages.ts`·`core/src/transport.ts`에서 이 플러그인이 쓰는 모양만 옮겼다
- 고친 것: import 경로만 (`.js` 확장자 제거, 폴더 위치). 그 밖의 예외는 아래 표
- 가져오지 않은 것: VS Code 확장, 서버, React 화면(`components`, `editor`), 소리, `exportLayout`, 가구·바닥·벽·양탄자·반려동물 그림

| 파일 | 고친 곳 |
|---|---|
| `layout/furnitureCatalog.ts` | 카탈로그를 만들 때마다 찍는 `console.log` 한 줄 제거 |
| 웹 타입 검사에 걸리는 14개 파일 | 맨 위 `@ts-nocheck`. 웹의 `noUncheckedIndexedAccess`에 맞지 않고, 고치면 원본과 멀어진다 |

## 그림

- `characters/char_0~5.png`: 캐릭터. upstream이 JIK-A-4의 Metro City를 바탕으로 다듬은 그림을 그대로 복사했다. 원본은 제작자 페이지(jik-a-4.itch.io/metrocity-free-topdown-character-pack)에 CC0 1.0으로 표시돼 있다 (2026-11-01 확인). upstream은 그림만의 라이선스를 따로 적지 않았고 저장소 전체가 MIT다
- 가구·바닥·벽 그림은 라이선스가 불분명해서 (upstream 이슈 #355) 복사하지 않았다. 이 플러그인의 `web/room.ts`가 코드로 직접 그린다
