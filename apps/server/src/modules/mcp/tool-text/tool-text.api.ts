import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { ActivateToolTextInput, SaveToolTextInput } from './tool-text.input';
import { ToolTextQuery } from './tool-text.query';
import { ToolTextService } from './tool-text.service';
import type {
  ToolTextDetailView,
  ToolTextListView,
  ToolTextRevisionView,
  ToolTextSavedView,
} from './tool-text.view';

// 콘솔 "도구 설명" 메뉴: MCP 도구의 글을 콘솔 판으로 고친다. 주인만 (Service · Query 첫 줄에서 확인).
@Controller('api/tool-texts')
export class ToolTextController {
  constructor(
    private readonly query: ToolTextQuery,
    private readonly service: ToolTextService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<ToolTextListView> {
    return this.query.list(actor);
  }

  @Get(':tool')
  detail(@CurrentActor() actor: Actor, @Param('tool') tool: string): Promise<ToolTextDetailView> {
    return this.query.detail(actor, tool);
  }

  @Get(':tool/revisions/:revision')
  revision(
    @CurrentActor() actor: Actor,
    @Param('tool') tool: string,
    @Param('revision') revision: string,
  ): Promise<ToolTextRevisionView> {
    return this.query.revision(actor, tool, Number(revision));
  }

  /** 새 판 (바로 그 판을 쓴다) */
  @Post(':tool/revisions')
  async save(
    @CurrentActor() actor: Actor,
    @Param('tool') tool: string,
    @Body() body: unknown,
  ): Promise<ToolTextSavedView> {
    return (await this.service.saveRevision(actor, SaveToolTextInput.from(tool, body))).view();
  }

  /** 쓸 판 옮기기. revision이 null이면 기본 글 (기본으로) */
  @HttpCode(200)
  @Put(':tool/active')
  async activate(
    @CurrentActor() actor: Actor,
    @Param('tool') tool: string,
    @Body() body: unknown,
  ): Promise<ToolTextSavedView> {
    return (await this.service.activate(actor, ActivateToolTextInput.from(tool, body))).view();
  }
}
