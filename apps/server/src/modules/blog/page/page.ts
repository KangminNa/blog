import { BaseEntity, DomainEvent, NotFound, RuleViolation, TableEntity } from '../../platform';
import type { PageNew, PageRevisionNew, PageRow } from '../blog.tables';
import { SlugPolicy } from '../post/slug.policy';
import { PageView } from './page.view';
import type { PageFiles } from './page-files';

// 페이지 하나 (blog.pages + blog.page_revisions, 기획서 결정 2026-11-12).
// AI가 만든 HTML 묶음을 블로그처럼 바깥 주소(/pages/<이름>/)로 내보낸다. 판은 추가만 하고(트리거), 보이는 판(current_seq)을 옮긴다.
// 새 판이 오면 곧바로 그 판이 보인다 (만들면 곧 배포). 기본은 주인만 보고, 방문자에게 보이게 하는 것은 주인만 정한다 (원칙 5 · 7).
export class Page extends TableEntity<PageRow, PageNew> {
  static readonly PRIVATE = 'private';
  static readonly PUBLIC = 'public';
  static readonly VISIBILITIES: readonly string[] = [Page.PRIVATE, Page.PUBLIC];
  static readonly TITLE_MAX = 120;
  static readonly NOTE_MAX = 4000;
  static readonly CHANGED = 'blog.page.changed';
  /** 제목에 글자가 없을 때의 이름 */
  private static readonly FALLBACK_NAME = 'page';
  /** 이번에 쌓을 판 (saveParts가 넣는다) */
  private added: PageRevisionNew | null = null;

  /** 첫 판과 함께 만든다. 이름은 공간 안에서 겹치지 않게 부르는 쪽이 정한다 (Page.nameOf) */
  static open(spaceId: string, name: string, title: string, now: Date): Page {
    return new Page(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        name,
        title: Page.titleOf(title),
        visibility: Page.PRIVATE,
        current_seq: 0,
        revisions: 0,
        created_at: now,
        updated_at: now,
      },
      true,
    );
  }

  static restore(row: PageRow): Page {
    return new Page(row);
  }

  /** 제목에서 만든 주소 이름 (예: "서울 데이트 코스" → "서울-데이트-코스") */
  static nameOf(title: string): string {
    return /[\p{L}\p{N}]/u.test(title) ? SlugPolicy.fromTitle(title) : Page.FALLBACK_NAME;
  }

  get name(): string {
    return this.row.name;
  }

  /** 새 판을 쌓고 바로 그 판을 보이게 한다 */
  publish(files: PageFiles, taskId: string, runId: string, note: string, now: Date): void {
    const seq = this.row.revisions + 1;
    this.put('revisions', seq);
    this.put('current_seq', seq);
    this.put('updated_at', now);
    this.added = {
      id: BaseEntity.newId(),
      page_id: this.id,
      seq,
      files: files.toJSON(),
      task_id: taskId,
      run_id: runId,
      note: note.slice(0, Page.NOTE_MAX),
      created_at: now,
    };
    this.announce();
  }

  /** 주인이 제목 · 공개 범위를 바꾼다. 주지 않은 것은 그대로 */
  edit(title: string | null, visibility: string | null, now: Date): void {
    if (title !== null) this.put('title', Page.titleOf(title));
    if (visibility !== null) {
      if (!Page.VISIBILITIES.includes(visibility))
        throw new RuleViolation(`공개 범위는 ${Page.VISIBILITIES.join(' · ')} 중 하나예요`);
      this.put('visibility', visibility);
    }
    this.put('updated_at', now);
    this.announce();
  }

  /** 보이는 판을 옮긴다 (되돌리기도 같다). 이미 그 판이면 아무것도 바뀌지 않는다 */
  switchTo(seq: number, now: Date): void {
    if (seq < 1 || seq > this.row.revisions) throw new NotFound(`없는 버전이에요: ${seq}`);
    if (seq === this.row.current_seq) return;
    this.put('current_seq', seq);
    this.put('updated_at', now);
    this.announce();
  }

  /** 저장할 새 판 (Repository가 부른다) */
  get addedRevision(): PageRevisionNew | null {
    return this.added;
  }

  view(): PageView {
    return new PageView(this.row);
  }

  private static titleOf(title: string): string {
    const text = title.trim().slice(0, Page.TITLE_MAX);
    if (!text) throw new RuleViolation('제목을 적어 주세요');
    return text;
  }

  private announce(): void {
    this.record(
      new DomainEvent(Page.CHANGED, 1, this.row.space_id, {
        pageId: this.id,
        name: this.row.name,
        currentSeq: this.row.current_seq,
        visibility: this.row.visibility,
      }),
    );
  }
}
