import { Controller, Get, Param } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { WikiIdInput } from '../wiki/wiki.input';
import { WikiScoreQuery } from './wiki-score.query';
import type { WikiScoreBoardView, WikiScoreDetailView } from './wiki-score.view';

// wiki 점수 (주인만). 점수는 읽을 때 계산한다 (docs/wiki점수.md).
@Controller('api/wiki-scores')
export class WikiScoreController {
  constructor(private readonly scores: WikiScoreQuery) {}

  /** 카테고리별 순위(미분류는 끝)와 히스토리 */
  @Get()
  board(@CurrentActor() actor: Actor): Promise<WikiScoreBoardView> {
    return this.scores.board(actor);
  }

  /** wiki 하나의 점수와 어디서 얼마나 물려받았는지 */
  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<WikiScoreDetailView> {
    return this.scores.get(actor, WikiIdInput.from(id));
  }
}
