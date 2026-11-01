import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { PostEventInput } from './post-mark.input';
import { PostMarkService } from './post-mark.service';

// blog의 글 이벤트(blog.post.*)로 글 자리 사본을 맞춘다. 두 번 와도, 순서가 바뀌어도 결과가 같다.
@Injectable()
export class PostMarkHandler extends BaseHandler {
  constructor(private readonly marks: PostMarkService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const input = PostEventInput.from(event);
    if (input) await this.marks.keep(new SystemActor(), event.spaceId, input);
  }
}
