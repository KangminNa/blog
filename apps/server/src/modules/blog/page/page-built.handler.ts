import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { PageBuiltInput } from './page.input';
import { PageService } from './page.service';

// 만들기 작업이 끝나며 알린 페이지 파일 묶음을 받아 판으로 쌓는다 (task를 부르지 않고 이벤트로 잇는다).
// 두 번 받아도 판은 하나다 (실행마다 하나).
@Injectable()
export class PageBuiltHandler extends BaseHandler {
  static readonly TOPIC = 'task.page.built';

  constructor(private readonly pages: PageService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    await this.pages.built(new SystemActor(), event.spaceId, PageBuiltInput.from(event.data));
  }
}
