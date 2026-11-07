import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import { ChangeService } from '../change/change.service';
import type { ChangeSet } from '../change/change-set';
import type { Category } from './category';
import { CreateCategoryInput, DeleteCategoryInput, UpdateCategoryInput } from './category.input';
import { CategoryQuery } from './category.query';
import type { CategoryListView, CategorySavedView } from './category.view';

/** 카테고리 목록. 방문자는 공개 칸만 */
export class CategoryListResponse extends BaseResponse {
  private constructor(
    private readonly view: CategoryListView,
    private readonly full: boolean,
  ) {
    super();
  }

  static of(view: CategoryListView, actor: Actor): CategoryListResponse {
    return new CategoryListResponse(view, actor.canSeePrivate());
  }

  toJSON(): object {
    return this.full ? this.view.toJSON() : this.view.toPublicJSON();
  }
}

// 카테고리 메뉴. 목록은 누구나 (이름은 공개), 쓰기는 주인만 (변경 묶음으로 남는다).
@Controller('api/categories')
export class CategoryController {
  constructor(
    private readonly categories: CategoryQuery,
    private readonly changes: ChangeService,
  ) {}

  @Get()
  async list(@CurrentActor() actor: Actor): Promise<CategoryListResponse> {
    return CategoryListResponse.of(await this.categories.list(actor), actor);
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<CategorySavedView> {
    return CategoryController.saved(await this.changes.edit(actor, CreateCategoryInput.from(body)));
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CategorySavedView> {
    return CategoryController.saved(
      await this.changes.edit(actor, UpdateCategoryInput.from(id, body)),
    );
  }

  @Delete(':id')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CategorySavedView> {
    return CategoryController.saved(
      await this.changes.edit(actor, DeleteCategoryInput.from(id, body)),
    );
  }

  /** 만들거나 고친 카테고리 하나. 화면은 이 version으로 다음 변경을 보낸다 */
  private static saved(set: ChangeSet): CategorySavedView {
    return (set.result as Category).view(set.id);
  }
}
