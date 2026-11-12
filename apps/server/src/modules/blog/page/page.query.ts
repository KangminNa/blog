import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, BlobStore, Database, NotFound, SecretBox } from '../../platform';
import type { PageRevisionRow, PageRow } from '../blog.tables';
import { Page } from './page';
import type { PageSiteInput, ReadPageInput } from './page.input';
import {
  PageDetailView,
  PageListView,
  PageRevisionView,
  PageView,
  PublicPageListView,
  PublicPageView,
} from './page.view';
import { PageFiles } from './page-files';
import { PageTicket } from './page-ticket';

/** 바깥 주소의 답: 보낼 파일이거나, 다른 주소로 보내기 */
export class PageSiteAnswer {
  /** 페이지 안의 스크립트가 우리 로그인에 닿지 못하게 격리해서 연다 (같은 주소지만 다른 출처로 취급된다) */
  static readonly CSP =
    'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';

  private constructor(
    readonly redirect: string | null,
    readonly stream: Readable | null,
    readonly type: string,
    readonly size: number,
    readonly cacheControl: string,
  ) {}

  static to(url: string): PageSiteAnswer {
    return new PageSiteAnswer(url, null, '', 0, 'no-store');
  }

  static file(stream: Readable, name: string, size: number, isPublic: boolean): PageSiteAnswer {
    return new PageSiteAnswer(
      null,
      stream,
      PageFiles.typeOf(name),
      size,
      // 보이는 판이 바뀌면 곧 반영되게 짧게. 비공개는 어디에도 남기지 않는다
      isPublic ? 'public, max-age=60' : 'private, no-store',
    );
  }
}

// 페이지 읽기. 콘솔의 목록 · 상세는 주인만, 방문자는 공개 페이지의 이름 · 제목만 본다.
// 바깥 주소(/pages/<이름>/…)는 공개 페이지면 누구나, 비공개면 주인만: 방문자에게는 없는 페이지와 똑같이 답한다.
@Injectable()
export class PageQuery extends BaseQuery {
  /** 바깥 주소의 앞부분 (웹이 /pages/…를 api/pages/site/…로 넘긴다) */
  static readonly SITE = '/pages';
  private static readonly MISSING = '없는 페이지예요';

  constructor(
    db: Database,
    private readonly blobs: BlobStore,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  async list(actor: Actor): Promise<PageListView | PublicPageListView> {
    const all = actor.kind === 'owner';
    const rows = await this.sql<PageRow[]>`
      SELECT p.* FROM blog.pages p
      WHERE ${this.inSpace(actor)} ${all ? this.sql`` : this.sql`AND p.visibility = ${Page.PUBLIC}`}
      ORDER BY p.updated_at DESC, p.id DESC`;
    return all
      ? new PageListView(rows.map((r) => new PageView(r)))
      : new PublicPageListView(rows.map((r) => new PublicPageView(r)));
  }

  /** 페이지 하나와 판 목록 (새 판부터). 주인만 */
  async detail(actor: Actor, req: ReadPageInput): Promise<PageDetailView> {
    actor.assertOwner();
    const [page] = await this.sql<PageRow[]>`
      SELECT p.* FROM blog.pages p WHERE ${this.inSpace(actor)} AND p.id = ${req.id}`;
    if (!page) throw new NotFound(PageQuery.MISSING);
    const revisions = await this.sql<PageRevisionRow[]>`
      SELECT * FROM blog.page_revisions WHERE page_id = ${page.id} ORDER BY seq DESC`;
    return new PageDetailView(
      new PageView(page),
      revisions.map((r) => new PageRevisionView(r, PageFiles.of(r.files).toJSON())),
    );
  }

  /**
   * 바깥 주소 하나. 파일 이름이 없으면 문(index.html)으로 보내고, 비공개 페이지를 주인이 열면 보기 표가 든 주소로 보낸다
   * (격리된 페이지 안에서는 쿠키가 실리지 않아 딸린 파일을 표로 받는다)
   */
  async site(actor: Actor, req: PageSiteInput, now: Date): Promise<PageSiteAnswer> {
    const ticketPage =
      req.ticket === null ? null : PageTicket.open(this.box, req.ticket, now).pageId;
    const [page] = await this.sql<PageRow[]>`
      SELECT p.* FROM blog.pages p WHERE ${this.inSpace(actor)} AND p.name = ${req.name}
        ${ticketPage === null ? this.sql`` : this.sql`AND p.id = ${ticketPage}`}`;
    if (!page) throw new NotFound(PageQuery.MISSING);
    const isPublic = page.visibility === Page.PUBLIC;
    const name = encodeURIComponent(page.name);
    if (ticketPage === null && !isPublic) {
      if (actor.kind !== 'owner') throw new NotFound(PageQuery.MISSING);
      const ticket = new PageTicket(page.id).seal(this.box, now);
      return PageSiteAnswer.to(
        `${PageQuery.SITE}/${PageTicket.MARK}${ticket}/${name}/${encodeURIComponent(req.file ?? PageFiles.ENTRY)}`,
      );
    }
    if (req.file === null) {
      const base =
        req.ticket === null ? PageQuery.SITE : `${PageQuery.SITE}/${PageTicket.MARK}${req.ticket}`;
      return PageSiteAnswer.to(`${base}/${name}/${PageFiles.ENTRY}`);
    }
    const [revision] = await this.sql<PageRevisionRow[]>`
      SELECT * FROM blog.page_revisions WHERE page_id = ${page.id} AND seq = ${page.current_seq}`;
    const file = revision ? PageFiles.of(revision.files).find(req.file) : null;
    const blob = file ? await this.blobs.find(file.blobHash) : null;
    if (!file || !blob) throw new NotFound(PageQuery.MISSING);
    return PageSiteAnswer.file(
      await this.blobs.open(file.blobHash),
      file.name,
      blob.size,
      isPublic && ticketPage === null,
    );
  }

  /** hashes 가운데 판이 가리키는 파일 (BlobStore.registerUse: 쓰는 동안 platform이 파일을 지우지 않게) */
  async usedBlobs(actor: Actor, hashes: readonly string[]): Promise<string[]> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql<{ hash: string }[]>`
      SELECT DISTINCT f->>'blobHash' AS hash
      FROM blog.page_revisions r, jsonb_array_elements(r.files) f
      WHERE f->>'blobHash' = ANY(${hashes as string[]}::text[])`;
    return rows.map((row) => row.hash);
  }

  private inSpace(actor: Actor) {
    return actor.spaceId === null ? this.sql`TRUE` : this.sql`p.space_id = ${actor.spaceId}`;
  }
}
