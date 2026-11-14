// 기기 하나의 토큰 갱신을 따로 돌린다 (device-access.mjs가 띄운다. 띄운 훅 · 상태 줄이 끝나도 끝까지 간다).
//
//   node cairn-refresh.mjs <기기> [force]    기기: credentials.json의 키 (news · collect)
//
// 무엇이 실패해도 아무것도 찍지 않고 0으로 끝난다 (토큰을 찍지 않는다).
import { refreshNow } from './device-access.mjs';

const key = process.argv[2];
if (key === 'news' || key === 'collect')
  refreshNow(key, process.argv[3] === 'force').then(
    () => process.exit(0),
    () => process.exit(0),
  );
