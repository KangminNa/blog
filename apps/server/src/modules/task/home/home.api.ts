import { Controller, Get } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { HomeQuery } from './home.query';
import type { HomeView } from './home.view';

// 홈 (2차 1-1): 팀 · 진행 중인 대화 · 최근 결과물 · 기다리는 결재 수. 관리자만 (Query 첫 줄에서 확인)
@Controller('api/home')
export class HomeController {
  constructor(private readonly home: HomeQuery) {}

  @Get()
  get(@CurrentActor() actor: Actor): Promise<HomeView> {
    return this.home.home(actor);
  }
}
