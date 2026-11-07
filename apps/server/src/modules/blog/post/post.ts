import {
  Actor,
  ApprovedActor,
  BaseEntity,
  type ColumnRules,
  DomainEvent,
  Forbidden,
  RuleViolation,
  TableEntity,
} from '../../platform';
import type { PostNew, PostRevisionNew, PostRevisionRow, PostRow } from '../blog.tables';
import { SavedPostView, ToolDraftView } from './post.view';
import { PostContent } from './post-content';

/** 글 한 줄과 함께 읽는 칸: 지금 판의 제목·본문, 판 수, 참고 wiki */
export interface LoadedPost extends PostRow {
  head_title: string | null;
  head_body: string | null;
  revision_count: number;
  ref_wiki_ids: readonly string[] | null;
}

/** 글의 판 하나 (blog.post_revisions, 추가만): 그때의 제목과 본문 */
export class PostRevision extends TableEntity<PostRevisionRow, PostRevisionNew> {
  /** Actor 종류 → 판에 남기는 만든 쪽 (post_revisions.actor_type). 기기와 에이전트는 둘 다 AI 도구다 */
  private static readonly ACTOR_TYPES: Readonly<Record<string, string>> = {
    owner: 'user',
    device: 'ai',
    agent: 'ai',
    system: 'system',
  };

  /** seq: 몇 번째 판인가 (1부터). base: 바로 앞의 판 (첫 판이면 null) */
  static write(
    postId: string,
    seq: number,
    content: PostContent,
    base: string | null,
    requestId: string | null,
    by: Actor,
    now: Date,
  ): PostRevision {
    return new PostRevision(
      {
        id: BaseEntity.newId(),
        post_id: postId,
        seq,
        title: content.title,
        body_md: content.body,
        base_revision_id: base,
        request_id: requestId,
        actor_type: PostRevision.ACTOR_TYPES[by.kind] ?? 'system',
        actor_id: by.id,
        created_at: now,
      },
      true,
    );
  }
}

// 글. 저장할 때 내용(제목·본문)이 바뀌었으면 새 판이 쌓인다. 주소·태그·정렬·공개 범위는 판 없이 글에 둔다.
// posts의 title·excerpt·head_text는 지금 판의 찾기용 사본이라 글이 바뀔 때마다 지금 판에서 다시 적는다.
// 공개 범위(status): draft 임시(나만) · published 공개(목록에 보임) · unlisted 링크만(목록·검색에는 안 나오고 주소로만).
// 공개 범위 바꾸기·휴지통·공개된 글 고치기는 주인만 (AI 도구의 글쓰기 권한은 임시 글까지, 2026-10-03 결정).
// 주인이 결재한 공개 하나만 예외다 (publishApproved).
// 글 → wiki 연결(대표 하나 + 참고 여럿)은 판 없이 글에 둔다. vault에는 이벤트로 알린다 (외래키 없음).
export class Post extends TableEntity<PostRow, PostNew> {
  static readonly DRAFT = 'draft';
  static readonly PUBLISHED = 'published';
  static readonly UNLISTED = 'unlisted';
  static readonly STATUSES: readonly string[] = [Post.DRAFT, Post.PUBLISHED, Post.UNLISTED];
  static readonly ALIGNS: readonly string[] = ['left', 'center'];
  static readonly TAGS_MAX = 20;
  static readonly TAG_MAX = 40;
  /** 글 하나의 참고 wiki */
  static readonly REFS_MAX = 20;
  /** 휴지통에 둔 글을 영구히 지우기까지 (영구 삭제 일꾼은 뒤 단계) */
  static readonly TRASH_DAYS = 30;
  /** 결재로 맡기는 공개 (task.approvals.action) */
  static readonly PUBLISH_ACTION = 'blog.post.publish';
  /** 대상이 없어 결재한 공개를 하지 못했을 때의 이유 */
  static readonly NO_POST = '없는 글이라 공개하지 않았어요';
  private static readonly PUBLISH_FAILED = 'blog.post.publish_failed';

  /** 글을 쓰는 쪽이 정하는 칸과 그 규칙 */
  private static readonly RULES: ColumnRules<PostRow> = {
    /** 모양과 겹침은 SlugPolicy가 먼저 본다 (겹침은 DB를 읽어야 안다) */
    slug: (value) => value,
    /** 앞뒤 빈칸·# 지우기, 빈 것·겹치는 것 빼기 */
    tags: (value) => {
      const clean = [
        ...new Set(
          value.map((t) => t.trim().replace(/^#+/, '').trim()).filter((t) => t.length > 0),
        ),
      ];
      if (clean.length > Post.TAGS_MAX)
        throw new RuleViolation(`태그는 ${Post.TAGS_MAX}개까지예요`);
      const long = clean.find((t) => t.length > Post.TAG_MAX);
      if (long) throw new RuleViolation(`태그는 ${Post.TAG_MAX}자까지예요: ${long}`);
      return clean;
    },
    align: (value) => {
      if (!Post.ALIGNS.includes(value))
        throw new RuleViolation(`정렬은 ${Post.ALIGNS.join(' · ')} 중 하나예요`);
      return value;
    },
  };

  /** 이번에 새로 쌓인 판 */
  private added: PostRevision | null = null;
  /** 이번에 wiki 연결이 바뀌었는가 (참고 wiki는 딸린 표라 바뀐 칸으로 알 수 없다) */
  private relinked = false;

  private constructor(
    row: PostRow | PostNew,
    /** 지금 판의 내용 */
    private head: PostContent,
    private revisions: number,
    /** 대표와 겹치지 않는 참고 wiki. 늘 id 순서다 */
    private refWikis: readonly string[],
    fresh = false,
  ) {
    super(row, fresh);
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

  /**
   * 새 글: 임시 상태로 첫 판과 함께. 주소는 Service가 SlugPolicy로 겹치지 않게 정해 넣는다.
   * 적지 않은 태그는 없고 정렬은 left다
   */
  static open(
    by: Actor,
    content: PostContent,
    fields: Omit<PostNew, 'id' | 'space_id'>,
    requestId: string,
    now: Date,
  ): Post {
    const post = new Post(
      {
        id: BaseEntity.newId(),
        space_id: Post.spaceOf(by),
        slug: fields.slug,
        status: Post.DRAFT,
        main_wiki_id: null,
        published_at: null,
      },
      content,
      0,
      [],
      true,
    );
    post.accept({ tags: [], align: 'left', ...fields }, Post.RULES);
    post.addRevision(content, requestId, by, now);
    post.touch(now);
    return post;
  }

  static restore(row: LoadedPost): Post {
    return new Post(
      row,
      PostContent.restore(row.head_title ?? '', row.head_body ?? ''),
      row.revision_count,
      row.ref_wiki_ids ?? [],
    );
  }

  /** 지금 주소 (고쳐 쓸 때 주소를 보내지 않으면 이 주소의 겹침을 다시 본다) */
  get slug(): string {
    return this.row.slug;
  }

  /** 이번에 새로 쌓인 판 (Repository가 저장한다) */
  get addedRevision(): PostRevision | null {
    return this.added;
  }

  /** 저장할 참고 wiki (Repository가 저장한다). 바뀌지 않았으면 null */
  get unsavedRefs(): readonly string[] | null {
    return this.relinked ? this.refWikis : null;
  }

  /**
   * 고쳐 쓰기. 제목·본문이 바뀌었으면 새 판을 쌓는다. 주소·태그·정렬은 판 없이 바꾸고, 적지 않은 칸은 그대로다.
   * 공개된 글(공개·링크만)은 주인만 고친다.
   */
  edit(content: PostContent, changes: Partial<PostRow>, by: Actor, now: Date): void {
    this.assertLive();
    if (this.row.status !== Post.DRAFT) Post.assertOwner(by);
    const before = this.row;
    this.accept(changes, Post.RULES);
    const revised = !content.sameAs(this.head);
    if (revised) this.addRevision(content, null, by, now);
    // 칸이 실제로 바뀌었을 때만 행이 새 객체가 된다 (put)
    if (this.row !== before) this.touch(now);
    if (revised && this.row.status === Post.PUBLISHED) this.announceUpdate();
  }

  /**
   * 글 → wiki 연결 바꾸기. undefined는 그대로, 대표 null과 참고 []는 비우기다.
   * 겹치는 참고와 대표와 같은 참고는 뺀다. 판은 쌓지 않는다 (판은 제목·본문만).
   * AI는 임시 글까지만 잇고, 공개된 글은 주인만. 결재한 공개는 공개만 하고 연결을 바꾸지 않는다.
   */
  linkWikis(
    mainWikiId: string | null | undefined,
    refWikiIds: readonly string[] | undefined,
    by: Actor,
    now: Date,
  ): void {
    if (mainWikiId === undefined && refWikiIds === undefined) return;
    if (by instanceof ApprovedActor)
      throw new Forbidden('publish', '결재한 공개는 wiki 연결을 바꾸지 못해요');
    this.assertLive();
    if (this.row.status !== Post.DRAFT) Post.assertOwner(by);
    const main = mainWikiId === undefined ? this.row.main_wiki_id : mainWikiId;
    const refs = Post.cleanRefs(refWikiIds ?? this.refWikis, main);
    if (main === this.row.main_wiki_id && refs.join('\n') === this.refWikis.join('\n')) return;
    this.put('main_wiki_id', main);
    this.refWikis = refs;
    this.relinked = true;
    this.touch(now);
    if (this.row.status === Post.PUBLISHED) this.announceUpdate();
  }

  /** 공개 범위 바꾸기. 처음 공개(공개·링크만)한 때를 발행일로 남긴다 */
  changeStatus(status: string, by: Actor, now: Date): void {
    Post.assertOwner(by);
    this.assertLive();
    if (!Post.STATUSES.includes(status))
      throw new RuleViolation(`공개 범위는 ${Post.STATUSES.join(' · ')} 중 하나예요`);
    const was = this.row.status;
    if (status === was) return;
    this.put('status', status);
    if (status !== Post.DRAFT && !this.row.published_at) this.put('published_at', now);
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
    if (problem) return Post.publishFailed(this.row.space_id, this.id, approvalId, problem);
    this.put('status', Post.PUBLISHED);
    if (!this.row.published_at) this.put('published_at', now);
    this.touch(now);
    return this.event('blog.post.published', { approvalId, outcome: 'done' });
  }

  /** 휴지통으로. 판과 주소는 그대로 두고, TRASH_DAYS 뒤에 영구히 지울 수 있다 */
  trash(by: Actor, now: Date): void {
    Post.assertOwner(by);
    this.assertLive();
    this.put('deleted_at', now);
    this.put('purge_after', new Date(now.getTime() + Post.TRASH_DAYS * 24 * 60 * 60 * 1000));
    this.touch(now);
    this.announce('blog.post.deleted');
  }

  /** 휴지통에서 되살리기. 공개 범위는 지우기 전 그대로 */
  recover(by: Actor, now: Date): void {
    Post.assertOwner(by);
    if (!this.row.deleted_at) throw new RuleViolation('휴지통에 있는 글이 아니에요');
    this.put('deleted_at', null);
    this.put('purge_after', null);
    this.touch(now);
    if (this.row.status === Post.PUBLISHED) this.announce('blog.post.published');
  }

  /** 쓰기 결과. 제목과 앞부분은 찾기용 사본이 아니라 지금 판에서 */
  view(): SavedPostView {
    const { title, excerpt, body } = this.head;
    return new SavedPostView(
      { ...this.row, title, excerpt },
      body,
      this.revisions,
      this.added !== null,
      this.refWikis,
    );
  }

  /** blog_save_draft의 답 */
  draftView(site: string): ToolDraftView {
    return new ToolDraftView(this.row, site);
  }

  /** 같은 값은 적지 않는다: 아무것도 바뀌지 않으면 저장할 것도, 오를 버전도 없다 */
  protected override put<K extends keyof PostRow>(column: K, value: PostRow[K]): void {
    const was = this.row[column];
    const same =
      Array.isArray(was) && Array.isArray(value)
        ? was.join('\n') === value.join('\n')
        : was === value;
    if (!same) super.put(column, value);
  }

  private addRevision(content: PostContent, requestId: string | null, by: Actor, now: Date): void {
    const base = this.row.head_revision_id ?? null;
    this.revisions += 1;
    this.added = PostRevision.write(this.id, this.revisions, content, base, requestId, by, now);
    this.head = content;
    this.put('head_revision_id', this.added.id);
  }

  /** 고친 때를 적고 찾기용 사본(제목·앞부분·찾기용 글자)을 지금 판에 맞춘다 */
  private touch(now: Date): void {
    this.put('title', this.head.title);
    this.put('excerpt', this.head.excerpt);
    this.put('head_text', this.head.searchText);
    this.put('updated_at', now);
  }

  private announce(topic: string): void {
    this.record(this.event(topic));
  }

  /**
   * 공개 글이 바뀌었다고 알린다. 한 번의 저장에 내용과 연결이 함께 바뀌어도 이벤트는 마지막 모습 하나다:
   * 두 이벤트의 postVersion이 같아 vault 사본은 앞의 것만 받으므로, 앞의 것을 버리고 다시 적는다.
   */
  private announceUpdate(): void {
    this.pullEvents();
    this.announce('blog.post.updated');
  }

  /** vault의 글 자리 사본이 순서를 맞추도록 저장 뒤의 글 버전을 함께 보낸다 */
  private event(topic: string, more: Readonly<Record<string, unknown>> = {}): DomainEvent {
    return new DomainEvent(topic, 1, this.row.space_id, {
      postId: this.id,
      slug: this.row.slug,
      title: this.head.title,
      status: this.row.status,
      postVersion: this.isNew ? 1 : this.version + 1,
      mainWikiId: this.row.main_wiki_id,
      refWikiIds: this.refWikis,
      ...more,
    });
  }

  /** 결재한 대로 공개할 수 없는 이유. 공개 범위를 바꿔도 버전이 오르므로 사람이 먼저 공개했으면 바뀐 글이다 */
  private publishProblem(targetVersion: number): string | null {
    if (this.row.deleted_at) return '휴지통에 있는 글이라 공개하지 않았어요';
    if (this.version !== targetVersion)
      return `결재를 올린 뒤 바뀐 글이라 공개하지 않았어요 (결재 ${targetVersion}, 지금 ${this.version})`;
    if (this.row.status === Post.PUBLISHED) return '이미 공개된 글이에요';
    return null;
  }

  private assertLive(): void {
    if (this.row.deleted_at)
      throw new RuleViolation('휴지통에 있는 글이에요. 되살린 뒤 고쳐 주세요');
  }

  private static assertOwner(by: Actor): void {
    if (by.kind !== 'owner')
      throw new Forbidden('publish', '공개 범위·휴지통·공개된 글 고치기는 주인만 할 수 있어요');
  }

  /** 참고 wiki: 겹치는 것과 대표와 같은 것을 빼고 id 순서로 (보낸 순서만 달라서는 바뀐 것이 아니다) */
  private static cleanRefs(refs: readonly string[], main: string | null): readonly string[] {
    return [...new Set(refs)].filter((id) => id !== main).sort();
  }
}
