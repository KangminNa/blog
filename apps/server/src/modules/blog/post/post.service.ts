import { Injectable } from '@nestjs/common';
import { Actor, AgentActor, BaseService, Idempotency } from '../../platform';
import { Post } from './post';
import { PostRepository } from './post.repository';
import type {
  CreatePostRequest,
  PostStatusRequest,
  PostVersionRequest,
  SaveDraftRequest,
  SavePostRequest,
} from './post.request';
import { PostContent } from './post-content';
import { SlugPolicy } from './slug.policy';

// 글 쓰기: 새 글, 고쳐 쓰기(새 판), 공개 범위, 휴지통·되살리기. 관리 화면의 편집기가 부른다.
// AI 도구의 초안은 saveDraft 하나로 온다. 무엇을 할 수 있는지는 Post가 정한다: 공개된 글은 주인만 고친다.
@Injectable()
export class PostService extends BaseService {
  private static readonly CREATE = 'create_post';
  private static readonly DRAFT = 'blog_save_draft';

  /** 같은 requestId가 다시 오면 처음 만든 글을 그대로 돌려준다 (두 번 눌러도 글은 하나) */
  async create(actor: Actor, req: CreatePostRequest): Promise<Post> {
    actor.assertCan(Actor.WRITE);
    const spaceId = Post.spaceOf(actor);
    const content = PostContent.write(req.title, req.body);
    return this.transaction(async (tx) => {
      const posts = new PostRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, PostService.CREATE);
      const before = await once.previous();
      if (before) return posts.load(spaceId, String(before.postId));
      const wanted = SlugPolicy.wanted(req.slug, content.title);
      const taken = await posts.takenSlugs(spaceId, wanted, null);
      const slug = SlugPolicy.pick(wanted, taken, req.slug !== null);
      const post = Post.open(actor, slug, content, req.tags, req.align, req.requestId, new Date());
      await posts.save(post);
      await once.remember({ postId: post.id });
      return post;
    });
  }

  /** 고쳐 쓰기: 제목·본문이 바뀌었으면 새 판. 주소를 보내지 않으면 지금 주소 그대로 */
  async save(actor: Actor, req: SavePostRequest): Promise<Post> {
    actor.assertCan(Actor.WRITE);
    const spaceId = Post.spaceOf(actor);
    const content = PostContent.write(req.title, req.body);
    return this.transaction(async (tx) => {
      const posts = new PostRepository(tx);
      const post = await posts.lock(spaceId, req.id);
      post.assertVersion(req.version);
      const wanted = SlugPolicy.check(req.slug ?? post.slug);
      const slug = SlugPolicy.pick(wanted, await posts.takenSlugs(spaceId, wanted, post.id), true);
      post.edit(content, slug, req.tags, req.align, actor, new Date());
      await posts.save(post);
      return post;
    });
  }

  /**
   * AI 도구의 초안: post_id가 없으면 새 초안, 있으면 그 초안을 고친다. 주소·정렬은 건드리지 않는다.
   * 응답을 못 받아 같은 request_id로 다시 보내면 처음 저장한 글을 돌려준다.
   * request_id는 AI가 만들어서, 다른 작업에서 같은 값을 써도 앞 글이 돌아오지 않게 작업마다 센다.
   */
  async saveDraft(actor: Actor, req: SaveDraftRequest): Promise<Post> {
    actor.assertCan(Actor.WRITE);
    const spaceId = Post.spaceOf(actor);
    const content = PostContent.write(req.title, req.body);
    const scope = actor instanceof AgentActor ? actor.taskId : (actor.id ?? spaceId);
    return this.transaction(async (tx) => {
      const posts = new PostRepository(tx);
      const once = new Idempotency(tx, scope, req.requestId, PostService.DRAFT);
      const before = await once.previous();
      if (before) return posts.load(spaceId, String(before.postId));
      const now = new Date();
      let post: Post;
      if (req.postId === null) {
        const wanted = SlugPolicy.fromTitle(content.title);
        const slug = SlugPolicy.pick(wanted, await posts.takenSlugs(spaceId, wanted, null), false);
        post = Post.open(actor, slug, content, req.tags ?? [], 'left', req.requestId, now);
      } else {
        post = await posts.lock(spaceId, req.postId);
        post.assertVersion(req.baseVersion ?? 0);
        post.edit(content, post.slug, req.tags ?? post.tags, post.align, actor, now);
      }
      await posts.save(post);
      await once.remember({ postId: post.id });
      return post;
    });
  }

  async changeStatus(actor: Actor, req: PostStatusRequest): Promise<Post> {
    actor.assertCan(Actor.WRITE);
    const spaceId = Post.spaceOf(actor);
    return this.transaction(async (tx) => {
      const posts = new PostRepository(tx);
      const post = await posts.lock(spaceId, req.id);
      post.assertVersion(req.version);
      post.changeStatus(req.status, actor, new Date());
      await posts.save(post);
      return post;
    });
  }

  async trash(actor: Actor, req: PostVersionRequest): Promise<Post> {
    actor.assertCan(Actor.WRITE);
    const spaceId = Post.spaceOf(actor);
    return this.transaction(async (tx) => {
      const posts = new PostRepository(tx);
      const post = await posts.lock(spaceId, req.id);
      post.assertVersion(req.version);
      post.trash(actor, new Date());
      await posts.save(post);
      return post;
    });
  }

  async recover(actor: Actor, req: PostVersionRequest): Promise<Post> {
    actor.assertCan(Actor.WRITE);
    const spaceId = Post.spaceOf(actor);
    return this.transaction(async (tx) => {
      const posts = new PostRepository(tx);
      const post = await posts.lock(spaceId, req.id);
      post.assertVersion(req.version);
      post.recover(actor, new Date());
      await posts.save(post);
      return post;
    });
  }
}
