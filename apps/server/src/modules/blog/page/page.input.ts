import { BaseRequest, NotFound } from '../../platform';
import { Page } from './page';
import { PageTicket } from './page-ticket';

/** GET /api/pages/:id */
export class ReadPageInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): ReadPageInput {
    return BaseRequest.read({ id }, (f) => new ReadPageInput(f.uuid('id')));
  }
}

/** PATCH /api/pages/:id: 본 version과 바꿀 것 (주지 않은 것은 그대로) */
export class EditPageInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly title: string | null,
    readonly visibility: string | null,
  ) {
    super();
  }

  static from(id: string, raw: unknown): EditPageInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new EditPageInput(
          f.uuid('id'),
          f.version(),
          f.optionalText('title', Page.TITLE_MAX),
          f.optionalText('visibility', 20),
        ),
    );
  }
}

/** POST /api/pages/:id/current: 보일 판 */
export class SwitchPageInput extends BaseRequest {
  private static readonly SEQ_MAX = 2_147_483_647;

  private constructor(
    readonly id: string,
    readonly version: number,
    readonly seq: number,
  ) {
    super();
  }

  static from(id: string, raw: unknown): SwitchPageInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new SwitchPageInput(
          f.uuid('id'),
          f.version(),
          f.integer('seq', 1, SwitchPageInput.SEQ_MAX),
        ),
    );
  }
}

/** 이벤트 task.page.built의 내용: 만들기 작업이 끝나며 알린 파일 묶음. 파일의 모양은 PageFiles가 본다 */
export class PageBuiltInput extends BaseRequest {
  private constructor(
    readonly taskId: string,
    readonly runId: string,
    /** 고칠 페이지. 없으면 새 페이지 */
    readonly pageId: string | null,
    readonly title: string,
    readonly note: string,
    readonly files: unknown,
  ) {
    super();
  }

  static from(raw: unknown): PageBuiltInput {
    const data = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      data,
      (f) =>
        new PageBuiltInput(
          f.uuid('taskId'),
          f.uuid('runId'),
          data.pageId === undefined || data.pageId === null ? null : f.uuid('pageId'),
          f.text('title', 500),
          f.optionalText('note', 20_000) ?? '',
          data.files,
        ),
    );
  }
}

// 바깥 주소(/pages/…)의 경로: <이름> · <이름>/<파일> · ~<표>/<이름> · ~<표>/<이름>/<파일>.
// 파일 이름에는 경로가 없어 조각은 셋까지다. 모양이 아니면 없는 페이지와 같다 (404).
export class PageSiteInput {
  private constructor(
    /** 비공개 페이지의 보기 표. 없으면 로그인으로 본다 */
    readonly ticket: string | null,
    readonly name: string,
    /** 없으면 페이지의 문(index.html)으로 보낸다 */
    readonly file: string | null,
  ) {}

  static from(path: string | readonly string[]): PageSiteInput {
    const parts = (Array.isArray(path) ? path : String(path ?? '').split('/')).filter(
      (part) => part !== '',
    );
    const ticket = parts[0]?.startsWith(PageTicket.MARK) ? String(parts.shift()).slice(1) : null;
    const [name, file = null, ...rest] = parts;
    if (!name || rest.length > 0 || ticket === '') throw new NotFound('없는 페이지예요');
    return new PageSiteInput(ticket, name, file);
  }
}
