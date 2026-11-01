import { Injectable } from '@nestjs/common';
import { Actor, BaseService } from '../../platform';
import { PostMark } from './post-mark';
import type { PostEventInput } from './post-mark.input';
import { PostMarkRepository } from './post-mark.repository';

// 글 자리 사본 쓰기. blog 이벤트를 받는 일꾼만 부른다.
@Injectable()
export class PostMarkService extends BaseService {
  async keep(actor: Actor, spaceId: string, event: PostEventInput): Promise<void> {
    actor.assertCan(Actor.TIDY);
    await this.transaction(async (tx) => {
      const marks = new PostMarkRepository(tx);
      const now = new Date();
      const found = await marks.lock(event.postId);
      found?.receive(event, now);
      await marks.save(found ?? PostMark.open(spaceId, event, now));
    });
  }
}
