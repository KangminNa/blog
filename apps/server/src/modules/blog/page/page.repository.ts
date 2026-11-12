import { TableRepository } from '../../platform';
import { pageRevisions, pages } from '../blog.schema';
import type { PageRow } from '../blog.tables';
import { Page } from './page';

// blog.pages ↔ Page. 판(blog.page_revisions)은 saveParts로 함께 넣는다 (추가만).
export class PageRepository extends TableRepository<PageRow, Page> {
  protected readonly table = pages;
  protected readonly noun = '페이지';

  protected toEntity(row: PageRow): Page {
    return Page.restore(row);
  }

  /** 공간의 페이지를 만들거나 판을 쌓는 동안 하나씩만: 이름이 겹치지 않게, 같은 실행의 판이 둘 생기지 않게 */
  async lockSpace(spaceId: string): Promise<void> {
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`blog.pages:${spaceId}`}, 0))`;
  }

  /** 그 실행이 만든 판이 이미 있는가 (같은 이벤트를 두 번 받았을 때) */
  async hasRun(spaceId: string, runId: string): Promise<boolean> {
    const [row] = await this.sql`
      SELECT 1 FROM blog.page_revisions r JOIN blog.pages p ON p.id = r.page_id
      WHERE p.space_id = ${spaceId} AND r.run_id = ${runId} LIMIT 1`;
    return row !== undefined;
  }

  /** 공간에서 아직 안 쓰는 이름: 원하는 이름이 있으면 뒤에 -2, -3 …을 붙인다 */
  async freeName(spaceId: string, wanted: string): Promise<string> {
    const rows = await this.sql<{ name: string }[]>`
      SELECT name FROM blog.pages
      WHERE space_id = ${spaceId} AND (name = ${wanted} OR name LIKE ${`${wanted}-%`})`;
    const taken = new Set(rows.map((r) => r.name));
    if (!taken.has(wanted)) return wanted;
    for (let n = 2; ; n += 1) if (!taken.has(`${wanted}-${n}`)) return `${wanted}-${n}`;
  }

  protected override async saveParts(page: Page): Promise<void> {
    const revision = page.addedRevision;
    if (revision) await this.insertRows(pageRevisions, revision);
  }
}
