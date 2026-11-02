import { Injectable } from '@nestjs/common';
import { ApprovedActor, BaseHandler, type DomainEvent } from '../../platform';
import { Post } from './post';
import { ApprovedPublishInput } from './post.input';
import { PostService } from './post.service';

// 주인이 승인한 공개를 받아 실행한다. 다른 동작의 승인은 그 동작을 가진 모듈의 일이라 넘어간다.
// 공개할지는 PostService와 Post가 정하고, 결과는 이벤트로 task에 간다. 두 번 받아도 결과가 같다.
@Injectable()
export class PublishApprovedHandler extends BaseHandler {
  static readonly TOPIC = 'task.approval.granted';

  constructor(private readonly posts: PostService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.data.action !== Post.PUBLISH_ACTION) return;
    const req = ApprovedPublishInput.from(event.data);
    await this.posts.publishApproved(
      new ApprovedActor(event.spaceId, req.decidedBy, req.approvalId, req.action),
      req.postId,
      req.targetVersion,
    );
  }
}
