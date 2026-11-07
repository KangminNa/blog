import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  Database,
  EntityService,
  Idempotency,
  type Sql,
  type VersionTarget,
} from '../../platform';
import { PostWikiQuery } from '../../vault';
import { Post } from './post';
import type {
  CreatePostInput,
  PostStatusInput,
  PostVersionInput,
  SaveDraftInput,
  SavePostInput,
} from './post.input';
import { PostRepository } from './post.repository';
import { PostContent } from './post-content';
import { SlugPolicy } from './slug.policy';

// 글 쓰기: 새 글, 고쳐 쓰기(새 판), 공개 범위, 휴지통·되살리기. 관리 화면의 편집기가 부른다.
// 결재한 공개는 일꾼이 publishApproved로 부른다.
// AI 도구의 초안은 saveDraft 하나로 온다. 무엇을 할 수 있는지는 Post가 정한다: 공개된 글은 주인만 고친다.
// 이을 wiki는 트랜잭션을 열기 전에 vault Query로 확인한다 (vault와 한 트랜잭션에 묶지 않는다).
@Injectable()
export class PostService extends EntityService<Post> {
  private static readonly CREATE = 'create_post';
  private static readonly DRAFT = 'blog_save_draft';
  private static readonly PUBLISH = 'publish_approved';

  constructor(
    db: Database,
    private readonly wikis: PostWikiQuery,
  ) {
    super(db);
  }

  protected store(tx: Sql): PostRepository {
    return new PostRepository(tx);
  }

  /** 같은 requestId가 다시 오면 처음 만든 글을 그대로 돌려준다 (두 번 눌러도 글은 하나) */
  async create(actor: Actor, req: CreatePostInput): Promise<Post> {
    actor.assertCan(Actor.WRITE);
    const spaceId = Post.spaceOf(actor);
    const content = PostContent.write(req.title, req.body);
    await this.wikis.assertVisible(actor, req.wikiIds);
    return this.transaction(async (tx) => {
      const posts = new PostRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, PostService.CREATE);
      const before = await once.previous();
      if (before) return posts.load(spaceId, String(before.postId));
      const manual = req.fields.slug ?? null;
      const wanted = SlugPolicy.wanted(manual, content.title);
      const taken = await posts.takenSlugs(spaceId, wanted, null);
      const slug = SlugPolicy.pick(wanted, taken, manual !== null);
      const now = new Date();
      const post = Post.open(actor, content, { ...req.fields, slug }, req.requestId, now);
      post.linkWikis(req.mainWikiId, req.refWikiIds, actor, now);
      await posts.save(post);
      await once.remember({ postId: post.id });
      return post;
    });
  }

  /** 고쳐 쓰기: 제목·본문이 바뀌었으면 새 판. 주소·wiki 연결을 보내지 않으면 지금 그대로 */
  async save(actor: Actor, req: SavePostInput): Promise<Post> {
    actor.assertCan(Actor.WRITE);
    const spaceId = Post.spaceOf(actor);
    const content = PostContent.write(req.title, req.body);
    await this.wikis.assertVisible(actor, req.wikiIds);
    return this.transaction(async (tx) => {
      const posts = new PostRepository(tx);
      const post = await posts.lock(spaceId, req.id);
      post.assertVersion(req.version);
      const wanted = SlugPolicy.check(req.changes.slug ?? post.slug);
      const slug = SlugPolicy.pick(wanted, await posts.takenSlugs(spaceId, wanted, post.id), true);
      const now = new Date();
      post.edit(content, { ...req.changes, slug }, actor, now);
      post.linkWikis(req.mainWikiId, req.refWikiIds, actor, now);
      await posts.save(post);
      return post;
    });
  }

  /**
   * AI 도구의 초안: post_id가 없으면 새 초안, 있으면 그 초안을 고친다. 주소·정렬은 건드리지 않는다.
   * 응답을 못 받아 같은 request_id로 다시 보내면 처음 저장한 글을 돌려준다.
   * request_id는 AI가 만들어서, 다른 작업에서 같은 값을 써도 앞 글이 돌아오지 않게 작업마다 센다.
   */
  async saveDraft(actor: Actor, req: SaveDraftInput): Promise<Post> {
    actor.assertCan(Actor.WRITE);
    const spaceId = Post.spaceOf(actor);
    const content = PostContent.write(req.title, req.body);
    const scope = actor instanceof AgentActor ? actor.taskId : (actor.id ?? spaceId);
    await this.wikis.assertVisible(actor, req.wikiIds);
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
        post = Post.open(actor, content, { ...req.changes, slug }, req.requestId, now);
      } else {
        post = await posts.lock(spaceId, req.postId);
        post.assertVersion(req.baseVersion ?? 0);
        post.edit(content, req.changes, actor, now);
      }
      post.linkWikis(req.mainWikiId, req.refWikiIds, actor, now);
      await posts.save(post);
      await once.remember({ postId: post.id });
      return post;
    });
  }

  changeStatus(actor: Actor, req: PostStatusInput): Promise<Post> {
    return this.changeAsWriter(actor, req, (post) =>
      post.changeStatus(req.status, actor, new Date()),
    );
  }

  /**
   * 주인이 결재한 공개. 글을 먼저 잠근다: 같은 결재가 겹쳐 와도 뒤쪽은 앞의 결과를 보고 그대로 다시 낸다.
   * 공개할 수 있는지는 Post가 정하고, 바뀐 내용과 결과 이벤트는 함께 커밋된다.
   */
  async publishApproved(actor: Actor, postId: string, targetVersion: number): Promise<void> {
    const approvalId = Post.approvalOf(actor);
    const spaceId = Post.spaceOf(actor);
    await this.transaction(async (tx) => {
      const posts = new PostRepository(tx);
      const post = await posts.lockOrNull(spaceId, postId);
      const once = new Idempotency(tx, spaceId, approvalId, PostService.PUBLISH);
      const before = await once.previous();
      if (before) return posts.announce(Post.sameResult(spaceId, before));
      const result = post
        ? post.publishApproved(actor, targetVersion, new Date())
        : Post.publishFailed(spaceId, postId, approvalId, Post.NO_POST);
      if (post) await posts.save(post);
      await posts.announce(result);
      await once.remember(result.toJSON());
    });
  }

  trash(actor: Actor, req: PostVersionInput): Promise<Post> {
    return this.changeAsWriter(actor, req, (post) => post.trash(actor, new Date()));
  }

  recover(actor: Actor, req: PostVersionInput): Promise<Post> {
    return this.changeAsWriter(actor, req, (post) => post.recover(actor, new Date()));
  }

  /** 글을 쓸 수 있는 요청자만 지나간다. 주인만 할 수 있는 일은 Post가 막는다 */
  private changeAsWriter(
    actor: Actor,
    target: VersionTarget,
    apply: (post: Post) => void,
  ): Promise<Post> {
    actor.assertCan(Actor.WRITE);
    return this.change(Post.spaceOf(actor), target, apply);
  }
}
