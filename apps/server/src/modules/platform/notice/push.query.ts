import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import { Database } from '../base/database';
import { PushGateway } from './push.gateway';
import { PushRepository } from './push.repository';
import { PushKeyView } from './push.view';

// 브라우저 푸시 읽기 (7단계). 주인만.
@Injectable()
export class PushQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly gateway: PushGateway,
  ) {
    super(db);
  }

  /** 서버의 공개 키(서버 키에서 만든다)와 이 공간의 구독 수 */
  async key(actor: Actor): Promise<PushKeyView> {
    actor.assertOwner();
    const targets = await new PushRepository(this.sql).targets(actor.requireSpace());
    return new PushKeyView(this.gateway.keys.publicKeyText, targets.length);
  }
}
