import { Operation, Read, type RequestFields } from '../../../apps/server/src/plugin-api';
import { BrowserScreenGateway, type ScreenAction } from './screen.gateway';
import { ControlledView, ScreenView } from './views';

// 콘솔에서 서버 브라우저를 보고 누르기 (2026-11-14). 영상(neko · UDP) 대신 화면 그림을 HTTPS로 받고, 클릭 · 입력을 보낸다.
// 로그인된 브라우저를 움직이는 길이라 관리자만. 표를 쓰지 않으니 트랜잭션 없이 돈다 (Read): 바깥 호출을 트랜잭션 안에서 기다리지 않는다.

/** GET /api/p/browser-tabs/screen?tab=: 탭 목록과 고른 탭의 화면 그림 (관리자) */
export class ScreenRead extends Read<{ tab: string | null }> {
  readonly name = 'screen';
  readonly allow = Operation.OWNER;

  constructor(private readonly screen: BrowserScreenGateway) {
    super();
  }

  input(raw: unknown) {
    return this.fields(raw, (f) => ({ tab: f.optionalText('tab', 64) }));
  }

  async run(_work: unknown, _actor: unknown, input: { tab: string | null }): Promise<ScreenView> {
    return new ScreenView(await this.screen.shot(input.tab));
  }
}

type ControlInput = { tab: string; action: ScreenAction };

/** POST /api/p/browser-tabs/screen/control: 탭 하나에 클릭 · 스크롤 · 글자 · 키 · 이동 · 뒤로 · 앞으로 가져오기 (관리자) */
export class ScreenControl extends Read<ControlInput> {
  readonly name = 'screenControl';
  readonly allow = Operation.OWNER;
  /** 좌표 · 스크롤의 범위 (CSS 픽셀) */
  private static readonly SPAN = 20_000;
  private static readonly TEXT_MAX = 2_000;
  private static readonly URL_MAX = 2_000;

  constructor(private readonly screen: BrowserScreenGateway) {
    super();
  }

  input(raw: unknown): ControlInput {
    return this.fields(raw, (f) => {
      const tab = f.text('tab', 64);
      if (tab && !BrowserScreenGateway.TAB_ID.test(tab)) f.reject('tab', '맞지 않는 탭 id예요');
      return { tab, action: ScreenControl.actionOf(f) };
    });
  }

  async run(_work: unknown, _actor: unknown, input: ControlInput): Promise<ControlledView> {
    await this.screen.control(input.tab, input.action);
    return new ControlledView();
  }

  /** 동작의 종류에 따라 칸을 읽는다. 모르는 종류 · 키 · http(s)가 아닌 주소는 그 칸의 오류로 */
  private static actionOf(f: RequestFields): ScreenAction {
    const span = ScreenControl.SPAN;
    const type = f.text('type', 20);
    const at = () => ({ x: f.integer('x', 0, span), y: f.integer('y', 0, span) });
    switch (type) {
      case 'click':
        return { type, ...at() };
      case 'scroll':
        return { type, ...at(), dy: f.integer('dy', -span, span) };
      case 'text':
        return { type, text: f.text('text', ScreenControl.TEXT_MAX) };
      case 'key': {
        const key = f.text('key', 20);
        if (key && !BrowserScreenGateway.KEY_NAMES.includes(key))
          f.reject('key', `보낼 수 있는 키는 ${BrowserScreenGateway.KEY_NAMES.join(' · ')}예요`);
        return { type, key };
      }
      case 'navigate': {
        const url = f.text('url', ScreenControl.URL_MAX);
        if (url && !/^https?:\/\//i.test(url)) f.reject('url', 'http · https 주소만 열 수 있어요');
        return { type, url };
      }
      case 'back':
      case 'activate':
        return { type };
      default:
        f.reject(
          'type',
          '동작은 click · scroll · text · key · navigate · back · activate 중 하나예요',
        );
        return { type: 'activate' };
    }
  }
}
