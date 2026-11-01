import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Actor, ArchiveFile, ArchiveQuery, BaseQuery, Database } from '../../platform';

// 글의 보관 파일 (docs/보관형식.md): blog/posts/<연도>/<주소>.md. 현재 판만, 휴지통 글은 빼고.
// 카테고리·시리즈·표지는 그 기능이 생기는 단계에서 앞부분에 더한다.
@Injectable()
export class PostArchiveQuery extends BaseQuery implements OnModuleInit {
  constructor(
    db: Database,
    private readonly archive: ArchiveQuery,
  ) {
    super(db);
  }

  onModuleInit(): void {
    this.archive.register('blog', (actor) => this.files(actor));
  }

  async files(actor: Actor): Promise<readonly ArchiveFile[]> {
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
      return ArchiveFile.markdown(
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
    });
  }
}
