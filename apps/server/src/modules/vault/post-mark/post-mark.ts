import { BaseEntity } from '../../platform';
import type { PostEventInput } from './post-mark.input';

// 글 자리 사본. vault는 blog를 읽지 않고 blog가 보낸 글 이벤트로 글 점과 선을 그린다.
// 이벤트 순서가 바뀌어도 postVersion이 더 큰 것만 반영한다.
export class PostMark extends BaseEntity {
  private static readonly PUBLISHED = 'published';
  private static readonly DRAFT = 'draft';

  private constructor(
    readonly postId: string,
    readonly spaceId: string,
    version: number,
    private titleValue: string,
    private slugValue: string,
    private statusValue: string,
    private mainWiki: string | null,
    private refWikis: readonly string[],
    private updatedOn: Date,
    private isDirty: boolean,
  ) {
    super(postId, version);
  }

  /** 처음 본 글 */
  static open(spaceId: string, event: PostEventInput, now: Date): PostMark {
    const mark = new PostMark(
      event.postId,
      spaceId,
      0,
      '',
      '',
      PostMark.DRAFT,
      null,
      [],
      now,
      false,
    );
    mark.receive(event, now);
    return mark;
  }

  static restore(
    postId: string,
    spaceId: string,
    postVersion: number,
    title: string,
    slug: string,
    status: string,
    mainWikiId: string | null,
    refWikiIds: readonly string[],
    updatedAt: Date,
  ): PostMark {
    return new PostMark(
      postId,
      spaceId,
      postVersion,
      title,
      slug,
      status,
      mainWikiId,
      refWikiIds,
      updatedAt,
      false,
    );
  }

  get title(): string {
    return this.titleValue;
  }

  get slug(): string {
    return this.slugValue;
  }

  /** 방문자 그래프에는 published만. 링크만 공개는 목록에 나오지 않는 글이라 draft와 같게 둔다 */
  get status(): string {
    return this.statusValue;
  }

  get mainWikiId(): string | null {
    return this.mainWiki;
  }

  get refWikiIds(): readonly string[] {
    return this.refWikis;
  }

  get updatedAt(): Date {
    return this.updatedOn;
  }

  /** 저장할 내용이 있는가 */
  get dirty(): boolean {
    return this.isDirty;
  }

  /** 글 이벤트를 받는다. 이미 본 버전보다 크지 않으면 그대로. 휴지통의 글은 그래프에서 빠진다 */
  receive(event: PostEventInput, now: Date): void {
    if (event.postVersion <= this.version) return;
    const live = !event.deleted;
    this.titleValue = event.title;
    this.slugValue = event.slug;
    this.statusValue =
      live && event.status === PostMark.PUBLISHED ? PostMark.PUBLISHED : PostMark.DRAFT;
    this.mainWiki = live ? event.mainWikiId : null;
    this.refWikis = live ? event.refWikiIds : [];
    this.updatedOn = now;
    this.isDirty = true;
    this.markSaved(event.postVersion);
  }
}
