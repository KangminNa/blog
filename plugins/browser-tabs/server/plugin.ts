import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { ApprovalDecided, TaskSettled } from './approvals';
import { BrowserJob, LoginNeeded } from './browse';
import { ClickDetail, HoldClick, ListClicks, ManualClick, NextClick, SaveClick } from './clicks';
import { ListReads, PendingReads, RequestRead, SaveRead } from './reads';
import { ScreenControl, ScreenRead } from './screen';
import { BrowserScreenGateway } from './screen.gateway';
import { ListShots, SaveShot, ShotDetail } from './shots';
import {
  AgentSites,
  ClearSession,
  CreateSite,
  DeleteSite,
  ListSites,
  RequestBrowse,
  RequestExplore,
  UpdateSite,
} from './sites';

// 첫 기능 패키지: 서버 브라우저를 쓰는 일 (docs/브라우저.md).
//   탭 읽기: 관리자가 고른 주소를 러너가 탭으로 열어 읽고 남긴다 (AI 없음)
//   브라우저 에이전트: 등록한 사이트(로그인된 프로필)나 둘러보기(일마다 새 빈 컨텍스트)에서 서버 러너의 AI가 일한다.
//     AI는 마지막 버튼 앞에서 멈추고, 러너(AI 없음)가 버튼 · 지문 · 화면을 붙잡아 결재를 올린다. 승인되면 러너가
//     같은 페이지 · 같은 버튼인지 다시 보고 누른다 (결재된 클릭). 로그인이 풀려 있으면 "로그인 필요" 결재로 기다린다
//   단계 화면: AI가 단계마다 찍은 화면과 러너가 찍은 화면을 작업에 남긴다
//   화면: 콘솔에서 서버 브라우저를 그림으로 보고 클릭 · 입력을 보낸다 (CDP 중계, HTTPS만). 사이트 세션 지우기
// 코어를 고치지 않고 자기 표(browser_tabs) · API(/api/p/browser-tabs/…) · MCP 도구 · 콘솔 메뉴를 갖는다.
export default class BrowserTabsPlugin extends BasePlugin {
  register(cairn: PluginContext): void {
    const screen = new BrowserScreenGateway();
    for (const operation of [
      new ListReads(),
      new RequestRead(),
      new PendingReads(),
      new SaveRead(),
      new ListSites(),
      new AgentSites(),
      new CreateSite(),
      new UpdateSite(),
      new DeleteSite(),
      new RequestBrowse(),
      new RequestExplore(),
      new ClearSession(screen),
      new BrowserJob(),
      new LoginNeeded(),
      new HoldClick(),
      new NextClick(),
      new SaveClick(),
      new ManualClick(),
      new ListClicks(),
      new ClickDetail(),
      new SaveShot(),
      new ListShots(),
      new ShotDetail(),
      new ScreenRead(screen),
      new ScreenControl(screen),
    ])
      cairn.addOperation(operation);
    cairn.onEvent('task.approval.granted', new ApprovalDecided('granted'));
    cairn.onEvent('task.approval.revision_requested', new ApprovalDecided('revised'));
    cairn.onEvent('task.approval.rejected', new ApprovalDecided('closed'));
    cairn.onEvent('task.approval.cancelled', new ApprovalDecided('closed'));
    cairn.onEvent('task.task.changed', new TaskSettled());
  }
}
