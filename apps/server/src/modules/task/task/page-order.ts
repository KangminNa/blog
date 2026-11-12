import { DomainEvent, RuleViolation } from '../../platform';
import type { OutputRow, TaskRow } from '../task.tables';

// 만들기 작업의 결과를 페이지로 내보내라는 주문 (payload.page, 기획서 결정 2026-11-12).
// 작업이 끝나면 이번 실행의 결과물 묶음을 이벤트(task.page.built)로 알리고, 페이지를 가진 모듈(blog)이 판으로 쌓는다.
// task는 발행하지 않는다: 무엇을 만들었는지만 알린다. 들어가는 문(index.html)이 없으면 페이지가 될 수 없어 작업을 실패로 끝낸다.
export class PageOrder {
  static readonly ENTRY = 'index.html';
  static readonly BUILT = 'task.page.built';
  /** 판 하나의 파일 수. 넘으면 페이지로 내보내지 않는다 */
  static readonly FILES_MAX = 100;
  private static readonly TITLE_MAX = 120;
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  private constructor(
    /** 새 페이지의 제목. 없으면 작업의 제목 */
    readonly title: string | null,
    /** 고칠 페이지 (blog의 것, 값). 없으면 새 페이지 */
    readonly pageId: string | null,
  ) {}

  /** 이 결과물 묶음을 페이지로 내보낼 수 없는 까닭. 내보낼 수 있으면 null */
  static refusal(outputs: readonly OutputRow[]): string | null {
    if (!outputs.some((o) => o.name === PageOrder.ENTRY))
      return `${PageOrder.ENTRY}이 없어 페이지로 내보내지 못했어요`;
    if (outputs.length > PageOrder.FILES_MAX)
      return `페이지의 파일은 ${PageOrder.FILES_MAX}개까지예요 (지금 ${outputs.length}개)`;
    return null;
  }

  /** 끝난 작업의 결과물 묶음을 알리는 이벤트. 판으로 쌓는 것은 페이지를 가진 모듈이 한다 */
  built(task: TaskRow, outputs: readonly OutputRow[]): DomainEvent {
    return new DomainEvent(PageOrder.BUILT, 1, task.space_id, {
      taskId: task.id,
      runId: outputs[0]?.run_id ?? null,
      pageId: this.pageId,
      title: this.title ?? task.title,
      note: task.instruction ?? '',
      files: outputs.map((o) => ({
        name: o.name,
        blobHash: o.blob_hash,
        mime: o.mime,
        sizeBytes: Number(o.size_bytes),
      })),
    });
  }

  /** payload의 page에서. 없으면 null, 모양이 틀리면 RuleViolation */
  static of(payload: unknown): PageOrder | null {
    const page = (payload as { page?: unknown } | null)?.page;
    if (page === undefined || page === null) return null;
    if (typeof page !== 'object' || Array.isArray(page))
      throw new RuleViolation('페이지(page)는 title · pageId를 담은 객체예요');
    const { title = null, pageId = null } = page as { title?: unknown; pageId?: unknown };
    if (title !== null && (typeof title !== 'string' || title.length > PageOrder.TITLE_MAX))
      throw new RuleViolation(`페이지 제목은 ${PageOrder.TITLE_MAX}자까지예요`);
    if (pageId !== null && (typeof pageId !== 'string' || !PageOrder.UUID.test(pageId)))
      throw new RuleViolation('고칠 페이지는 id로 적어요');
    return new PageOrder(title?.trim() || null, pageId);
  }
}
