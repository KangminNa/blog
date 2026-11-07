import { BaseRequest, type ColumnReaders } from '../../platform';
import { EditInput } from '../change/change.input';
import { CategoryCreateOp, CategoryDeleteOp, CategoryUpdateOp } from '../change/change-op';
import type { CategoryRow } from '../vault.tables';
import { Category } from './category';

// 카테고리 입력의 모양. 쓰기는 모두 변경 묶음이라 EditInput이 된다. 뜻(이름 규칙, 주소 모양)은 Category가 검사한다.

const SLUG_MAX = 200;
const MESSAGE = '관리 화면에서 고침';

/** 주인이 정하는 칸. 칸 하나에 한 줄이다. 보내지 않은 칸은 그대로, color·description에 null을 보내면 비운다 */
const COLUMNS: ColumnReaders<CategoryRow> = {
  name: (f, n) => f.optionalText(n, Category.NAME_MAX) ?? undefined,
  slug: (f, n) => f.optionalText(n, SLUG_MAX) ?? undefined,
  color: (f, n) => f.optionalText(n, Category.COLOR_MAX),
  description: (f, n) => f.optionalText(n, Category.DESCRIPTION_MAX),
  sort: (f, n) => f.optionalInteger(n, 0, Category.SORT_MAX) ?? undefined,
};

/** POST /api/categories. 같은 requestId는 처음 만든 카테고리를 돌려준다. 이름은 꼭 있어야 해서 먼저 읽는다 */
export class CreateCategoryInput extends BaseRequest {
  static from(raw: unknown): EditInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new EditInput(f.uuid('requestId'), MESSAGE, [
          new CategoryCreateOp(1, null, {
            name: f.text('name', Category.NAME_MAX),
            ...f.columns(COLUMNS),
          }),
        ]),
    );
  }
}

/** PATCH /api/categories/:id */
export class UpdateCategoryInput extends BaseRequest {
  static from(id: string, raw: unknown): EditInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new EditInput(null, MESSAGE, [
          new CategoryUpdateOp(1, f.uuid('id'), f.version(), f.columns(COLUMNS)),
        ]),
    );
  }
}

/** DELETE /api/categories/:id { version }. 휴지통으로 간다 */
export class DeleteCategoryInput extends BaseRequest {
  static from(id: string, raw: unknown): EditInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) => new EditInput(null, MESSAGE, [new CategoryDeleteOp(1, f.uuid('id'), f.version())]),
    );
  }
}
