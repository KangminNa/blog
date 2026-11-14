import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import {
  ConfirmPublish,
  CreateSite,
  DeleteSite,
  ListReads,
  ListSites,
  PendingReads,
  RequestBrowse,
  RequestRead,
  SaveRead,
  UpdateSite,
  Viewer,
} from './operations';
import { ScreenControl, ScreenRead } from './screen';
import { BrowserScreenGateway } from './screen.gateway';

// 첫 기능 패키지: 서버 브라우저(로그인된 프로필)를 쓰는 일.
//   탭 읽기: 주인이 고른 주소를 러너가 탭으로 열어 읽고 남긴다 (AI 없음)
//   브라우저 에이전트: 사이트를 등록하고 일을 맡기면, 서버 러너의 AI가 그 사이트에서 일하고 발행 직전에 결재를 올린다.
//     주인은 콘솔의 브라우저 화면에서 직접 발행하고 승인한다 (서버는 발행하지 않는다)
//   화면: 콘솔에서 서버 브라우저를 그림으로 보고 클릭 · 입력을 보낸다 (CDP 중계, HTTPS만. 2026-11-14)
// 코어를 고치지 않고 자기 표(browser_tabs) · API(/api/p/browser-tabs/…) · MCP 도구 · 콘솔 메뉴를 갖는다.
export default class BrowserTabsPlugin extends BasePlugin {
  register(cairn: PluginContext): void {
    cairn.addOperation(new ListReads());
    cairn.addOperation(new RequestRead());
    cairn.addOperation(new PendingReads());
    cairn.addOperation(new SaveRead());
    cairn.addOperation(new ListSites());
    cairn.addOperation(new CreateSite());
    cairn.addOperation(new UpdateSite());
    cairn.addOperation(new DeleteSite());
    cairn.addOperation(new RequestBrowse());
    cairn.addOperation(new Viewer());
    const screen = new BrowserScreenGateway();
    cairn.addOperation(new ScreenRead(screen));
    cairn.addOperation(new ScreenControl(screen));
    cairn.onEvent('task.approval.granted', new ConfirmPublish());
  }
}
