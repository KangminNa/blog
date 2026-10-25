import { Injectable } from '@nestjs/common';
import { Actor, BaseService, Idempotency } from '../../platform';
import { Post } from './post';
import { PostRepository } from './post.repository';
import type {
  CreatePostRequest,
  PostStatusRequest,
  PostVersionRequest,
  SavePostRequest,
} from './post.request';
import { PostContent } from './post-content';
import { SlugPolicy } from './slug.policy';

// 글 쓰기: 새 글, 고쳐 쓰기(새 판), 공개 범위, 휴지통·되살리기. 관리 화면의 편집기가 부른다.
// 뒤 단계에서 AI 도구의 초안(cairn-write, 글쓰기 권한)도 같은 create·save를 부른다.
@Injectable()
export class PostService extends BaseService {
  private static readonly CREATE = 'create_post';

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
