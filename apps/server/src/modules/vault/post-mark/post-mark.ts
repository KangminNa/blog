import { TableEntity } from '../../platform';
import type { NewNode } from '../change/change-target';
import type { PostMarkNew, PostMarkRow } from '../vault.tables';
import type { PostEventInput } from './post-mark.input';

/** post_marks 한 줄. 글 하나에 한 행이라 엔티티의 id는 글 id다 */
export interface LoadedPostMark extends PostMarkRow {
  id: string;
}

// 글 자리 사본. vault는 blog를 읽지 않고 blog가 보낸 글 이벤트로 글 점과 선을 그린다.
// 이벤트 순서가 바뀌어도 postVersion이 더 큰 것만 반영한다.
export class PostMark extends TableEntity<LoadedPostMark, NewNode<PostMarkNew>> {
  private static readonly PUBLISHED = 'published';
  private static readonly DRAFT = 'draft';

  /** 처음 본 글 */
  static open(spaceId: string, event: PostEventInput, now: Date): PostMark {
    const mark = new PostMark(
      {
        id: event.postId,
        post_id: event.postId,
        space_id: spaceId,
        title: '',
        slug: '',
        status: PostMark.DRAFT,
        main_wiki_id: null,
        ref_wiki_ids: [],
        post_version: 0,
      },
      true,
    );
    mark.receive(event, now);
    return mark;
  }

  static restore(row: LoadedPostMark): PostMark {
    return new PostMark(row);
  }

  /** 사본 한 줄. 저장은 늘 통째로 맞춘다 */
  get copy(): Readonly<LoadedPostMark> {
    return this.row;
  }

  /** 글 이벤트를 받는다. 이미 본 버전보다 크지 않으면 그대로. 휴지통의 글은 그래프에서 빠진다 */
  receive(event: PostEventInput, now: Date): void {
    if (event.postVersion <= this.row.post_version) return;
    const live = !event.deleted;
    this.put('title', event.title);
    this.put('slug', event.slug);
    // 방문자 그래프에는 published만. 링크만 공개는 목록에 나오지 않는 글이라 draft와 같게 둔다
    this.put(
      'status',
      live && event.status === PostMark.PUBLISHED ? PostMark.PUBLISHED : PostMark.DRAFT,
    );
    this.put('main_wiki_id', live ? event.mainWikiId : null);
    this.put('ref_wiki_ids', live ? event.refWikiIds : []);
    this.put('post_version', event.postVersion);
    this.put('updated_at', now);
  }
}
