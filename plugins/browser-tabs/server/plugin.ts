import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { ListReads, PendingReads, RequestRead, SaveRead } from './operations';

// 첫 기능 패키지: 주인이 고른 주소를 러너가 로그인된 브라우저 탭으로 열어 읽고 남긴다.
// 코어를 고치지 않고 자기 표(browser_tabs) · API(/api/p/browser-tabs/…) · MCP 도구 · 콘솔 메뉴를 갖는다.
export default class BrowserTabsPlugin extends BasePlugin {
  register(cairn: PluginContext): void {
    cairn.addOperation(new ListReads());
    cairn.addOperation(new RequestRead());
    cairn.addOperation(new PendingReads());
    cairn.addOperation(new SaveRead());
  }
}
