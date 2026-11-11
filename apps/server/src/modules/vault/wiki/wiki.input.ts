import { BaseRequest, type RequestFields } from '../../platform';
import { EditInput } from '../change/change.input';
import {
  CategoryAssignOp,
  type ChangeOp,
  EdgeAddOp,
  EdgeRemoveOp,
  WikiCreateOp,
  WikiRestoreOp,
  WikiReviseOp,
  WikiTrashOp,
} from '../change/change-op';
import { EdgeKind } from '../edge/edge';
import { Wiki } from './wiki';
import { WikiBody } from './wiki-body';

// wiki 입력의 모양. 쓰기는 모두 변경 묶음이라 콘솔 입력은 EditInput이 된다.
// REST(콘솔)는 camelCase, MCP(AI)는 snake_case로 받는다.

const SLUG_MAX = 200;
const MESSAGE_MAX = 2_000;

/** POST /api/wikis. 같은 requestId는 처음 만든 wiki를 돌려준다. 새 wiki는 늘 비공개다 */
export class CreateWikiInput extends BaseRequest {
  static from(raw: unknown): EditInput {
    return BaseRequest.read(raw, (f) => {
      const category = f.optionalText('categoryId', 36);
      return new EditInput(f.uuid('requestId'), f.optionalText('message', MESSAGE_MAX) ?? '', [
        new WikiCreateOp(
          1,
          null,
          f.text('title', Wiki.TITLE_MAX),
          WikiBody.parse(f.optionalText('bodyMd', WikiBody.MAX) ?? ''),
          f.optionalText('slug', SLUG_MAX),
          category === null ? null : f.uuid('categoryId'),
          null,
        ),
      ]);
    });
  }
}

/**
 * PUT /api/wikis/:id. 본문 전체를 보낸다 (비우려면 빈 문자열). 바뀐 칸은 사람의 것으로 표시된다.
 * categoryId를 보내지 않으면 그대로, null이면 미분류. visibility는 보낼 때만 바뀐다.
 */
export class SaveWikiInput extends BaseRequest {
  static from(id: string, raw: unknown): EditInput {
    const body = { ...(raw as object), id } as Record<string, unknown>;
    return BaseRequest.read(body, (f) => {
      const wikiId = f.uuid('id');
      const ops: ChangeOp[] = [
        new WikiReviseOp(
          1,
          wikiId,
          f.version(),
          f.text('title', Wiki.TITLE_MAX),
          WikiBody.parse(body.bodyMd === '' ? '' : f.text('bodyMd', WikiBody.MAX)),
          f.optionalText('visibility', 20),
        ),
      ];
      if ('categoryId' in body) {
        const category = f.optionalText('categoryId', 36);
        ops.push(
          new CategoryAssignOp(2, wikiId, null, category === null ? null : f.uuid('categoryId')),
        );
      }
      return new EditInput(null, f.optionalText('message', MESSAGE_MAX) ?? '', ops);
    });
  }
}

/** POST /api/wikis/:id/trash { version }. 휴지통으로 간다. 판 · 선 · 세션의 대표는 남는다 */
export class TrashWikiInput extends BaseRequest {
  static from(id: string, raw: unknown): EditInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new EditInput(null, '위키를 휴지통으로', [new WikiTrashOp(1, f.uuid('id'), f.version())]),
    );
  }
}

/** POST /api/wikis/:id/restore { version }. 휴지통에서 꺼낸다 */
export class RestoreWikiInput extends BaseRequest {
  static from(id: string, raw: unknown): EditInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new EditInput(null, '위키 되살리기', [new WikiRestoreOp(1, f.uuid('id'), f.version())]),
    );
  }
}

/**
 * POST /api/wikis/:id/replaces { oldId }: 이 wiki가 옛 wiki의 결론을 뒤집었다 (옛 wiki는 히스토리).
 * DELETE /api/wikis/:id/replaces/:oldId: 대체 표시를 지운다
 */
export class ReplaceWikiInput extends BaseRequest {
  static from(id: string, raw: unknown): EditInput {
    return BaseRequest.read({ ...(raw as object), id }, (f) => {
      const op = new EdgeAddOp(1, null, f.uuid('id'), f.uuid('oldId'), EdgeKind.REPLACES, true);
      return new EditInput(null, '대체 표시', [op]);
    });
  }

  static removing(id: string, oldId: string): EditInput {
    return BaseRequest.read({ id, oldId }, (f) => {
      const op = new EdgeRemoveOp(1, null, f.uuid('id'), f.uuid('oldId'), EdgeKind.REPLACES);
      return new EditInput(null, '대체 표시 지움', [op]);
    });
  }
}

/** GET /api/wikis?q=&category=&cursor=. 띄어 쓴 단어는 모두 들어 있어야 찾는다 */
export class ListWikisInput extends BaseRequest {
  private static readonly ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  private constructor(
    readonly words: readonly string[],
    readonly categoryId: string | null,
    /** 이 wiki보다 먼저 만든 wiki부터 */
    readonly before: string | null,
  ) {
    super();
  }

  static from(query: unknown): ListWikisInput {
    return BaseRequest.read(query, (f) => {
      const q = f.optionalText('q', 200) ?? '';
      const category = f.optionalText('category', 36);
      return new ListWikisInput(
        q.split(/\s+/).filter(Boolean),
        category === null ? null : f.uuid('category'),
        ListWikisInput.readCursor(f),
      );
    });
  }

  /** 커서: 앞 쪽의 마지막 wiki id. 찾기 도구도 같은 값을 쓴다 */
  static readCursor(f: RequestFields): string | null {
    const cursor = f.optionalText('cursor', 100);
    const before = cursor ? Buffer.from(cursor, 'base64url').toString() : null;
    if (before !== null && !ListWikisInput.ID.test(before))
      f.reject('cursor', '앞 응답의 next 값을 그대로 보내 주세요');
    return before;
  }

  /** 다음 쪽을 부를 값: 이 쪽의 마지막 wiki */
  static cursorAfter(id: string): string {
    return Buffer.from(id).toString('base64url');
  }
}

/** wiki 하나 (GET /api/wikis/:id) */
export class WikiIdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): WikiIdInput {
    return BaseRequest.read({ id }, (f) => new WikiIdInput(f.uuid('id')));
  }

  /** MCP `get_wiki` */
  static fromTool(raw: unknown): WikiIdInput {
    return BaseRequest.read(raw, (f) => new WikiIdInput(f.uuid('wiki_id')));
  }
}

/** wiki 찾기 (MCP `search_wikis`). 띄어 쓴 단어는 모두 들어 있어야 찾는다 */
export class SearchWikisInput extends BaseRequest {
  static readonly QUERY_MAX = 200;
  static readonly LIMIT_DEFAULT = 10;
  static readonly LIMIT_MAX = 30;

  private constructor(
    readonly words: readonly string[],
    readonly limit: number,
    readonly before: string | null,
  ) {
    super();
  }

  static from(raw: unknown): SearchWikisInput {
    return BaseRequest.read(raw, (f) => {
      const query = f.text('query', SearchWikisInput.QUERY_MAX);
      const words = query.split(/\s+/).filter(Boolean);
      if (query && words.length === 0) f.reject('query', '찾을 말을 써 주세요');
      return new SearchWikisInput(
        words,
        f.optionalInteger('limit', 1, SearchWikisInput.LIMIT_MAX) ?? SearchWikisInput.LIMIT_DEFAULT,
        ListWikisInput.readCursor(f),
      );
    });
  }
}
