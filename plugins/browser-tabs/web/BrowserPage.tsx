import type { Props } from './browser-types';
import { Clicks } from './Clicks';
import { Reads } from './Reads';
import { Screen } from './Screen';
import { Sites } from './Sites';

// browser-tabs의 콘솔 화면 (운영 › 브라우저). 서버 브라우저로 하는 일을 한곳에서 본다.
//   화면: 서버 브라우저를 그림으로 보고 클릭 · 입력을 보낸다 (Screen.tsx, HTTPS만). 로그인 · 바뀌어 누르지 못한 버튼은 여기서 직접
//   사이트 · 둘러보기: 에이전트가 일할 곳(로그인된 프로필)과 로그인 없는 새 창 조사. 사이트마다 세션 지우기 (Sites.tsx)
//   결재된 클릭: 멈춘 버튼과 누른 결과. 직접 한 것을 기록한다 (Clicks.tsx)
//   탭 읽기: 주소를 넣으면 러너가 탭으로 열어 글자만 읽는다 (Reads.tsx, AI 없음)
// 화면은 react와 이 폴더만 가져온다: 서버 호출(call)과 알림(notify)은 콘솔이 넘겨 준다.
export default function BrowserPage({ call, notify }: Props) {
  return (
    <div className="stack">
      <Screen call={call} />
      <Sites call={call} notify={notify} />
      <Clicks call={call} notify={notify} />
      <Reads call={call} notify={notify} />
    </div>
  );
}
