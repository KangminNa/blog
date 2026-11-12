import { Injectable } from '@nestjs/common';
import { type Actor, EntityService, type Sql } from '../../platform';
import { Page } from './page';
import type { EditPageInput, PageBuiltInput, SwitchPageInput } from './page.input';
import { PageRepository } from './page.repository';
import { PageFiles } from './page-files';

// 페이지 쓰기: 만들기 작업이 끝나며 알린 파일 묶음을 판으로 쌓고(일꾼), 주인이 제목 · 공개 범위 · 보이는 판을 바꾼다.
// AI는 판을 만들 뿐이다: 방문자에게 보이게 하는 것과 보이는 판을 옮기는 것은 주인만 (원칙 7).
@Injectable()
export class PageService extends EntityService<Page> {
  protected store(tx: Sql): PageRepository {
    return new PageRepository(tx);
  }

  /**
   * 만들기 작업이 끝났다 (task.page.built, 일꾼이 부른다). 고칠 페이지가 있으면 새 판을, 없으면 새 페이지를 만들고
   * 그 판을 바로 보이게 한다. 같은 이벤트를 두 번 받아도 판은 하나다 (실행마다 하나)
   */
  async built(actor: Actor, spaceId: string, req: PageBuiltInput): Promise<void> {
    actor.assertOwnerOrSystem();
    const files = PageFiles.of(req.files);
    const now = new Date();
    await this.transaction(async (tx) => {
      const pages = this.store(tx);
      await pages.lockSpace(spaceId);
      if (await pages.hasRun(spaceId, req.runId)) return;
      const page =
        (req.pageId === null ? null : await pages.lockOrNull(spaceId, req.pageId)) ??
        Page.open(spaceId, await pages.freeName(spaceId, Page.nameOf(req.title)), req.title, now);
      page.publish(files, req.taskId, req.runId, req.note, now);
      await pages.save(page);
    });
  }

  /** 제목 · 공개 범위 */
  edit(actor: Actor, req: EditPageInput): Promise<Page> {
    return this.changeAsOwner(actor, req, (page) =>
      page.edit(req.title, req.visibility, new Date()),
    );
  }

  /** 보이는 판을 옮긴다 (되돌리기) */
  switchTo(actor: Actor, req: SwitchPageInput): Promise<Page> {
    return this.changeAsOwner(actor, req, (page) => page.switchTo(req.seq, new Date()));
  }
}
