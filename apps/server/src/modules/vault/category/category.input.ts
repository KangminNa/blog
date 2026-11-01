import { BaseRequest } from '../../platform';
import { EditInput } from '../change/change.input';
import { CategoryCreateOp, CategoryDeleteOp, CategoryUpdateOp } from '../change/change-op';
import { Category } from './category';

// 카테고리 입력의 모양. 쓰기는 모두 변경 묶음이라 EditInput이 된다. 뜻(이름 규칙, 주소 모양)은 Category가 검사한다.

const VERSION_MAX = 2_147_483_647;
const SLUG_MAX = 200;
const COLOR_MAX = 40;
const MESSAGE = '관리 화면에서 고침';

/** POST /api/categories. 같은 requestId는 처음 만든 카테고리를 돌려준다 */
export class CreateCategoryInput extends BaseRequest {
  static from(raw: unknown): EditInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new EditInput(f.uuid('requestId'), MESSAGE, [
          new CategoryCreateOp(
            1,
            null,
            f.text('name', Category.NAME_MAX),
            f.optionalText('slug', SLUG_MAX),
            f.optionalText('color', COLOR_MAX),
            f.optionalText('description', Category.DESCRIPTION_MAX),
            f.optionalInteger('sort', 0, Category.SORT_MAX) ?? 0,
          ),
        ]),
    );
  }
}

/** PATCH /api/categories/:id. 보내지 않은 칸은 그대로, color·description에 null을 보내면 비운다 */
export class UpdateCategoryInput extends BaseRequest {
  static from(id: string, raw: unknown): EditInput {
    const body = { ...(raw as object), id };
    return BaseRequest.read(
      body,
      (f) =>
        new EditInput(null, MESSAGE, [
          new CategoryUpdateOp(
            1,
            f.uuid('id'),
            f.integer('version', 1, VERSION_MAX),
            f.optionalText('name', Category.NAME_MAX),
            f.optionalText('slug', SLUG_MAX),
            'color' in body ? f.optionalText('color', COLOR_MAX) : undefined,
            'description' in body
              ? f.optionalText('description', Category.DESCRIPTION_MAX)
              : undefined,
            f.optionalInteger('sort', 0, Category.SORT_MAX),
          ),
        ]),
    );
  }
}

/** DELETE /api/categories/:id { version }. 휴지통으로 간다 */
export class DeleteCategoryInput extends BaseRequest {
  static from(id: string, raw: unknown): EditInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new EditInput(null, MESSAGE, [
          new CategoryDeleteOp(1, f.uuid('id'), f.integer('version', 1, VERSION_MAX)),
        ]),
    );
  }
}
