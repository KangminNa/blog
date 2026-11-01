import {
  Actor,
  ApprovedActor,
  BaseEntity,
  DomainEvent,
  Forbidden,
  RuleViolation,
} from '../../platform';
import type { PostContent } from './post-content';

/** 글의 판 하나 (추가만): 그때의 제목과 본문 */
export class PostRevision {
  /** Actor 종류 → 판에 남기는 만든 쪽 (post_revisions.actor_type). 기기와 에이전트는 둘 다 AI 도구다 */
  private static readonly ACTOR_TYPES: Readonly<Record<string, string>> = {
    owner: 'user',
    device: 'ai',
    agent: 'ai',
    system: 'system',
  };

  private constructor(
    readonly id: string,
    readonly seq: number,
    readonly content: PostContent,
    readonly baseRevisionId: string | null,
    readonly requestId: string | null,
    readonly actorType: string,
    readonly actorId: string | null,
    readonly createdAt: Date,
  ) {}

  static write(
    id: string,
    seq: number,
    content: PostContent,
    baseRevisionId: string | null,
    requestId: string | null,
    by: Actor,
    now: Date,
  ): PostRevision {
    return new PostRevision(
      id,
      seq,
      content,
      baseRevisionId,
      requestId,
      PostRevision.ACTOR_TYPES[by.kind] ?? 'system',
      by.id,
      now,
    );
  }
}

// 글. 저장할 때 내용(제목·본문)이 바뀌었으면 새 판이 쌓인다. 주소·태그·정렬·공개 범위는 판 없이 글에 둔다.
// 공개 범위(status): draft 임시(나만) · published 공개(목록에 보임) · unlisted 링크만(목록·검색에는 안 나오고 주소로만).
// 공개 범위 바꾸기·휴지통·공개된 글 고치기는 주인만 (AI 도구의 글쓰기 권한은 임시 글까지, 2026-10-03 결정).
// 주인이 결재한 공개 하나만 예외다 (publishApproved).
export class Post extends BaseEntity {
  static readonly DRAFT = 'draft';
  static readonly PUBLISHED = 'published';
  static readonly UNLISTED = 'unlisted';
  static readonly STATUSES: readonly string[] = [Post.DRAFT, Post.PUBLISHED, Post.UNLISTED];
  static readonly ALIGNS: readonly string[] = ['left', 'center'];
  static readonly TAGS_MAX = 20;
  static readonly TAG_MAX = 40;
  /** 휴지통에 둔 글을 영구히 지우기까지 (영구 삭제 일꾼은 뒤 단계) */
  static readonly TRASH_DAYS = 30;
  /** 결재로 맡기는 공개 (task.approvals.action) */
  static readonly PUBLISH_ACTION = 'blog.post.publish';
  /** 대상이 없어 결재한 공개를 하지 못했을 때의 이유 */
  static readonly NO_POST = '없는 글이라 공개하지 않았어요';
  private static readonly PUBLISH_FAILED = 'blog.post.publish_failed';

  private added: PostRevision | null = null;
  private dirty = false;

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    private slugValue: string,
    private statusValue: string,
    /** 지금 판의 내용 */
    private head: PostContent,
    private tagList: readonly string[],
    private alignValue: string,
    private headId: string | null,
    private count: number,
    private publishedOn: Date | null,
    private updatedOn: Date,
    private deletedOn: Date | null,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  /** 요청자의 공간. 글은 공간에 속한다 */
  static spaceOf(by: Actor): string {
    if (!by.spaceId) throw new Forbidden(Actor.WRITE);
    return by.spaceId;
  }

  /** 결재로 공개하는 요청자의 결재 id. 그 밖의 요청자(주인도)와 다른 동작의 결재는 이 길로 오지 못한다 */
  static approvalOf(by: Actor): string {
    if (by instanceof ApprovedActor && by.action === Post.PUBLISH_ACTION) return by.approvalId;
    throw new Forbidden('publish', '결재한 공개만 할 수 있어요');
  }

  /** 결재한 공개의 실패 결과. 글을 찾지 못해도 작업은 끝나야 해서 글 없이 만든다 */
  static publishFailed(
    spaceId: string,
    postId: string,
    approvalId: string,
    error: string,
  ): DomainEvent {
    return new DomainEvent(Post.PUBLISH_FAILED, 1, spaceId, {
      postId,
      approvalId,
      outcome: 'failed',
      error,
    });
  }

  /** 앞서 낸 결과 그대로 (같은 결재가 다시 왔을 때). before는 그 이벤트의 toJSON() */
  static sameResult(spaceId: string, before: Readonly<Record<string, unknown>>): DomainEvent {
    return new DomainEvent(
      String(before.name),
      Number(before.v),
      spaceId,
      before.data as Readonly<Record<string, unknown>>,
    );
  }

  /** 새 글: 임시 상태로 첫 판과 함께 */
  static open(
    by: Actor,
    slug: string,
    content: PostContent,
    tags: readonly string[],
    align: string,
    requestId: string,
    now: Date,
  ): Post {
    const post = new Post(
      BaseEntity.newId(),
      1,
      Post.spaceOf(by),
      slug,
      Post.DRAFT,
      content,
      Post.cleanTags(tags),
      Post.alignOf(align),
      null,
      0,
      null,
      now,
      null,
      true,
    );
    post.addRevision(content, requestId, by, now);
    return post;
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    slug: string,
    status: string,
    head: PostContent,
    tags: readonly string[],
    align: string,
    headRevisionId: string | null,
    revisionCount: number,
    publishedAt: Date | null,
    updatedAt: Date,
    deletedAt: Date | null,
  ): Post {
    return new Post(
      id,
      version,
      spaceId,
      slug,
      status,
      head,
      tags,
      align,
      headRevisionId,
      revisionCount,
      publishedAt,
      updatedAt,
      deletedAt,
      false,
    );
  }

  get slug(): string {
    return this.slugValue;
  }

  get status(): string {
    return this.statusValue;
  }

  get content(): PostContent {
    return this.head;
  }

  get tags(): readonly string[] {
    return this.tagList;
  }

  get align(): string {
    return this.alignValue;
  }

  get headRevisionId(): string | null {
    return this.headId;
  }

  get revisionCount(): number {
    return this.count;
  }

  get publishedAt(): Date | null {
    return this.publishedOn;
  }

  get updatedAt(): Date {
    return this.updatedOn;
  }

  get deletedAt(): Date | null {
    return this.deletedOn;
  }

  /** 휴지통 글을 영구히 지울 수 있게 되는 때 */
  get purgeAfter(): Date | null {
    return this.deletedOn
      ? new Date(this.deletedOn.getTime() + Post.TRASH_DAYS * 24 * 60 * 60 * 1000)
      : null;
  }

  /** 이번에 새로 쌓인 판 (Repository가 저장한다) */
  get addedRevision(): PostRevision | null {
    return this.added;
  }

  /** 저장할 것이 있는가 (아무것도 바뀌지 않았으면 행을 건드리지 않는다) */
  get changed(): boolean {
    return this.isNew || this.dirty;
  }

  /**
   * 고쳐 쓰기. 제목·본문이 바뀌었으면 새 판을 쌓는다. 주소·태그·정렬은 판 없이 바꾼다.
   * 공개된 글(공개·링크만)은 주인만 고친다.
   */
  edit(
    content: PostContent,
    slug: string,
    tags: readonly string[],
    align: string,
    by: Actor,
    now: Date,
  ): void {
    this.assertLive();
    if (this.statusValue !== Post.DRAFT) Post.assertOwner(by);
    const cleanTags = Post.cleanTags(tags);
    const nextAlign = Post.alignOf(align);
    const revised = !content.sameAs(this.head);
    if (revised) this.addRevision(content, null, by, now);
    if (
      revised ||
      slug !== this.slugValue ||
      nextAlign !== this.alignValue ||
      cleanTags.join('\n') !== this.tagList.join('\n')
    ) {
      this.slugValue = slug;
      this.tagList = cleanTags;
      this.alignValue = nextAlign;
      this.touch(now);
    }
    if (revised && this.statusValue === Post.PUBLISHED) this.announce('blog.post.updated');
  }

  /** 공개 범위 바꾸기. 처음 공개(공개·링크만)한 때를 발행일로 남긴다 */
  changeStatus(status: string, by: Actor, now: Date): void {
    Post.assertOwner(by);
    this.assertLive();
    if (!Post.STATUSES.includes(status))
      throw new RuleViolation(`공개 범위는 ${Post.STATUSES.join(' · ')} 중 하나예요`);
    if (status === this.statusValue) return;
    const was = this.statusValue;
    this.statusValue = status;
    if (status !== Post.DRAFT && !this.publishedOn) this.publishedOn = now;
    this.touch(now);
    if (status === Post.PUBLISHED) this.announce('blog.post.published');
    else if (was === Post.PUBLISHED) this.announce('blog.post.unpublished');
  }

  /**
   * 주인이 결재한 공개. 결재한 그대로일 때만 공개하고, 아니면 아무것도 바꾸지 않고 실패를 돌려준다.
   * 결과는 기록하지 않고 돌려준다: 같은 결재가 다시 오면 Service가 이 결과를 그대로 다시 낸다.
   */
  publishApproved(by: Actor, targetVersion: number, now: Date): DomainEvent {
    const approvalId = Post.approvalOf(by);
    const problem = this.publishProblem(targetVersion);
    if (problem) return Post.publishFailed(this.spaceId, this.id, approvalId, problem);
    this.statusValue = Post.PUBLISHED;
    this.publishedOn ??= now;
    this.touch(now);
    return this.event('blog.post.published', { approvalId, outcome: 'done' });
  }

  /** 휴지통으로. 판과 주소는 그대로 두고, TRASH_DAYS 뒤에 영구히 지울 수 있다 */
  trash(by: Actor, now: Date): void {
    Post.assertOwner(by);
    this.assertLive();
    this.deletedOn = now;
    this.touch(now);
    this.announce('blog.post.deleted');
  }

  /** 휴지통에서 되살리기. 공개 범위는 지우기 전 그대로 */
  recover(by: Actor, now: Date): void {
    Post.assertOwner(by);
    if (!this.deletedOn) throw new RuleViolation('휴지통에 있는 글이 아니에요');
    this.deletedOn = null;
    this.touch(now);
    if (this.statusValue === Post.PUBLISHED) this.announce('blog.post.published');
  }

  private addRevision(content: PostContent, requestId: string | null, by: Actor, now: Date): void {
    const revision = PostRevision.write(
      BaseEntity.newId(),
      this.count + 1,
      content,
      this.headId,
      requestId,
      by,
      now,
    );
    this.added = revision;
    this.headId = revision.id;
    this.count = revision.seq;
    this.head = content;
  }

  private touch(now: Date): void {
    this.updatedOn = now;
    this.dirty = true;
  }

  private announce(topic: string): void {
    this.record(this.event(topic));
  }

  /** vault의 글 자리 사본이 순서를 맞추도록 저장 뒤의 글 버전을 함께 보낸다 */
  private event(topic: string, more: Readonly<Record<string, unknown>> = {}): DomainEvent {
    return new DomainEvent(topic, 1, this.spaceId, {
      postId: this.id,
      slug: this.slugValue,
      title: this.head.title,
      status: this.statusValue,
      postVersion: this.isNew ? 1 : this.version + 1,
      ...more,
    });
  }

  /** 결재한 대로 공개할 수 없는 이유. 공개 범위를 바꿔도 버전이 오르므로 사람이 먼저 공개했으면 바뀐 글이다 */
  private publishProblem(targetVersion: number): string | null {
    if (this.deletedOn) return '휴지통에 있는 글이라 공개하지 않았어요';
    if (this.version !== targetVersion)
      return `결재를 올린 뒤 바뀐 글이라 공개하지 않았어요 (결재 ${targetVersion}, 지금 ${this.version})`;
    if (this.statusValue === Post.PUBLISHED) return '이미 공개된 글이에요';
    return null;
  }

  private assertLive(): void {
    if (this.deletedOn) throw new RuleViolation('휴지통에 있는 글이에요. 되살린 뒤 고쳐 주세요');
  }

  private static assertOwner(by: Actor): void {
    if (by.kind !== 'owner')
      throw new Forbidden('publish', '공개 범위·휴지통·공개된 글 고치기는 주인만 할 수 있어요');
  }

  /** 태그: 앞뒤 빈칸·# 지우기, 빈 것·겹치는 것 빼기 */
  private static cleanTags(tags: readonly string[]): readonly string[] {
    const clean = [
      ...new Set(tags.map((t) => t.trim().replace(/^#+/, '').trim()).filter((t) => t.length > 0)),
    ];
    if (clean.length > Post.TAGS_MAX) throw new RuleViolation(`태그는 ${Post.TAGS_MAX}개까지예요`);
    const long = clean.find((t) => t.length > Post.TAG_MAX);
    if (long) throw new RuleViolation(`태그는 ${Post.TAG_MAX}자까지예요: ${long}`);
    return clean;
  }

  private static alignOf(align: string): string {
    if (!Post.ALIGNS.includes(align))
      throw new RuleViolation(`정렬은 ${Post.ALIGNS.join(' · ')} 중 하나예요`);
    return align;
  }
}
