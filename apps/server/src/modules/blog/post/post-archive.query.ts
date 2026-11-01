import { buffer } from 'node:stream/consumers';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type Actor,
  ArchiveFile,
  ArchiveQuery,
  BaseQuery,
  BlobStore,
  Database,
  NotFound,
} from '../../platform';
import { Post } from './post';

// 글의 보관 파일 (docs/보관형식.md): blog/posts/<연도>/<주소>.md와 사진 assets/<sha256>.<확장자>.
// 현재 판만, 휴지통 글과 휴지통 글에만 붙은 사진은 빼고.
// 카테고리·시리즈·표지는 그 기능이 생기는 단계에서 앞부분에 더한다.
@Injectable()
export class PostArchiveQuery extends BaseQuery implements OnModuleInit {
  /** 사진의 확장자. 받는 형식은 ImagePolicy와 같다 */
  private static readonly EXTENSIONS: Readonly<Record<string, string>> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };

  private readonly logger = new Logger('보관 파일');

  constructor(
    db: Database,
    private readonly archive: ArchiveQuery,
    private readonly blobs: BlobStore,
  ) {
    super(db);
  }

  onModuleInit(): void {
    this.archive.register('blog', (actor) => this.files(actor));
  }

  async files(actor: Actor): Promise<readonly ArchiveFile[]> {
    return [...(await this.posts(actor)), ...(await this.photos(actor))];
  }

  private async posts(actor: Actor): Promise<ArchiveFile[]> {
    const rows = await this.sql`
      SELECT p.id, p.slug, p.status, p.title, p.tags, p.align, p.main_wiki_id, p.published_at,
             r.body_md, first.created_at AS first_at,
             (SELECT array_agg(x.wiki_id ORDER BY x.wiki_id) FROM blog.post_wiki_refs x WHERE x.post_id = p.id) AS refs
      FROM blog.posts p
      JOIN blog.post_revisions r ON r.id = p.head_revision_id
      JOIN LATERAL (
        SELECT f.created_at FROM blog.post_revisions f WHERE f.post_id = p.id ORDER BY f.seq LIMIT 1
      ) first ON TRUE
      WHERE p.deleted_at IS NULL
        ${actor.spaceId === null ? this.sql`` : this.sql`AND p.space_id = ${actor.spaceId}`}
      ORDER BY p.id`;
    return rows.map((r) => {
      const year = new Date(r.published_at ?? r.first_at).getUTCFullYear();
      const tags = (r.tags as string[] | null) ?? [];
      const refs = (r.refs as string[] | null) ?? [];
      const file = ArchiveFile.markdown(
        `blog/posts/${year}/${r.slug}.md`,
        {
          cairn_format: ArchiveQuery.FORMAT,
          cairn_type: 'post',
          cairn_id: r.id,
          title: r.title,
          slug: r.slug,
          status: r.status,
          published: r.published_at === null ? null : new Date(r.published_at),
          ...(r.main_wiki_id === null ? {} : { cairn_main_wiki: r.main_wiki_id }),
          ...(refs.length === 0 ? {} : { cairn_ref_wikis: refs }),
          ...(tags.length === 0 ? {} : { tags }),
          align: r.align,
        },
        String(r.body_md),
      );
      return r.status === Post.PUBLISHED ? file : file.keptPrivate();
    });
  }

  /** 남은 글이 쓰는 사진. 이름이 내용의 해시라 여러 글에 붙어도 한 번만. 공개 글에 쓰인 것만 공개 저장소로 나간다 */
  private async photos(actor: Actor): Promise<ArchiveFile[]> {
    const rows = await this.sql`
      SELECT a.blob_hash, bool_or(p.status = ${Post.PUBLISHED}) AS open
      FROM blog.assets a JOIN blog.posts p ON p.id = a.post_id
      WHERE p.deleted_at IS NULL
        ${actor.spaceId === null ? this.sql`` : this.sql`AND p.space_id = ${actor.spaceId}`}
      GROUP BY a.blob_hash
      ORDER BY a.blob_hash`;
    const files: ArchiveFile[] = [];
    for (const row of rows) {
      const file = await this.photo(String(row.blob_hash));
      if (file) files.push(row.open === true ? file : file.keptPrivate());
    }
    return files;
  }

  /** 사진 하나. 디스크에 없는 파일 하나로 백업 전체를 막지 않는다: 빼고 로그를 남긴다 */
  private async photo(hash: string): Promise<ArchiveFile | null> {
    const blob = await this.blobs.find(hash);
    const extension = blob && PostArchiveQuery.EXTENSIONS[blob.mime];
    if (!extension) {
      this.logger.warn(`형식을 몰라 사진을 뺐어요: ${hash} (${blob?.mime ?? '정보 없음'})`);
      return null;
    }
    try {
      const body = await buffer(await this.blobs.open(hash));
      return ArchiveFile.bytes(`assets/${hash}.${extension}`, body);
    } catch (error) {
      if (!(error instanceof NotFound)) throw error;
      this.logger.warn(`디스크에 없어 사진을 뺐어요: ${hash}`);
      return null;
    }
  }
}
