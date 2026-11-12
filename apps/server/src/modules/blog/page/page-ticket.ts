import { NotFound, type SecretBox } from '../../platform';

// 비공개 페이지를 주인이 볼 때의 보기 표. 페이지는 격리해서 열기 때문에(쿠키가 실리지 않는다) 딸린 파일(css · 그림)을
// 로그인으로 받을 수 없다: 주소에 표를 실어 그 페이지의 파일만 받게 한다 (/pages/~<표>/<이름>/…).
// 서버 키로 봉인하고(용도 고정, 30분) 페이지 하나에 묶인다. 판에는 묶지 않아 보는 동안 판이 바뀌면 새 판이 보인다.
export class PageTicket {
  /** 주소에서 표를 알아보는 앞 글자 (페이지 이름은 글자 · 숫자로 시작한다) */
  static readonly MARK = '~';
  private static readonly PURPOSE = 'page-view';
  private static readonly TTL_SECONDS = 30 * 60;

  constructor(readonly pageId: string) {}

  /** 봉인한 표 */
  seal(box: SecretBox, now: Date): string {
    return box.pack(PageTicket.PURPOSE, this.pageId, PageTicket.TTL_SECONDS, now);
  }

  /** 표를 연다. 없거나 · 틀리거나 · 끝났으면 없는 페이지와 같다 (404) */
  static open(box: SecretBox, token: string, now: Date): PageTicket {
    const pageId = box.unpack(PageTicket.PURPOSE, token, now);
    if (pageId === null) throw new NotFound('없는 페이지예요');
    return new PageTicket(pageId);
  }
}
