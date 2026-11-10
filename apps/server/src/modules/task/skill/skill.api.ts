import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { ActivateSkillInput, SaveSkillRevisionInput } from './skill.input';
import { SkillQuery } from './skill.query';
import { SkillService } from './skill.service';
import type {
  SkillDetailView,
  SkillListView,
  SkillRevisionView,
  SkillSavedView,
} from './skill.view';

// 콘솔 "스킬" 메뉴: 러너 스킬의 콘솔 판. 주인만 (Service · Query 첫 줄에서 확인).
// api/skills는 앱에 올릴 스킬 zip(mcp 모듈)이 쓰고 있어 api/runner-skills를 쓴다.
@Controller('api/runner-skills')
export class SkillController {
  constructor(
    private readonly query: SkillQuery,
    private readonly service: SkillService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<SkillListView> {
    return this.query.list(actor);
  }

  @Get(':name')
  detail(@CurrentActor() actor: Actor, @Param('name') name: string): Promise<SkillDetailView> {
    return this.query.detail(actor, name);
  }

  @Get(':name/revisions/:revision')
  revision(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    @Param('revision') revision: string,
  ): Promise<SkillRevisionView> {
    return this.query.revision(actor, name, Number(revision));
  }

  /** 새 판 (바로 그 판을 쓴다) */
  @Post(':name/revisions')
  async save(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    @Body() body: unknown,
  ): Promise<SkillSavedView> {
    return (await this.service.saveRevision(actor, SaveSkillRevisionInput.from(name, body))).view();
  }

  /** 쓸 판 옮기기 (되돌리기). revision이 null이면 저장소 판 */
  @HttpCode(200)
  @Put(':name/active')
  async activate(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    @Body() body: unknown,
  ): Promise<SkillSavedView> {
    return (await this.service.activate(actor, ActivateSkillInput.from(name, body))).view();
  }
}
