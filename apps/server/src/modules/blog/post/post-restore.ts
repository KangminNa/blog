import { createHash } from 'node:crypto';
import {
  ArchiveBlob,
  ArchiveFile,
  ArchivePart,
  ArchiveQuery,
  type ArchiveRecord,
  BaseEntity,
  Blob,
  RuleViolation,
  type Sql,
} from '../../platform';
import { ImagePolicy } from '../asset/image.policy';
import { Post } from './post';
import { PostContent } from './post-content';
import { PostRestoreRepository } from './post-restore.repository';
import { SlugPolicy } from './slug.policy';

/** blog/posts/<연도>/<주소>.md 하나. 지금 판이 첫 판이 되고, 찾기용 글은 저장할 때와 같은 PostContent로 다시 만든다 */
export class RestoredPost extends BaseEntity {
  private static readonly FILE_REFERENCE = /\/api\/files\/([0-9a-f]{64})/g;
  private static readonly KNOWN: ReadonlySet<string> = new Set([
    'cairn_format',
    'cairn_type',
    'cairn_id',
    'title',
    'slug',
    'status',
    'published',
    'cairn_main_wiki',
    'cairn_ref_wikis',
    'cairn_assets',
    'tags',
    'align',
  ]);
  readonly revisionId = BaseEntity.newId();

  private constructor(
    id: string,
    readonly slug: string,
    readonly status: string,
    readonly content: PostContent,
    readonly tags: readonly string[],
    readonly align: string,
    readonly mainWikiId: string | null,
    readonly refWikiIds: readonly string[],
    readonly publishedAt: Date | null,
    /** 첫 판의 때. 임시 글의 연도 폴더가 이 값으로 정해지므로 내보낼 때 경로가 그대로다 */
    readonly writtenAt: Date,
    /** 이 글에 붙은 사진의 해시 */
    readonly photos: readonly string[],
    readonly meta: Readonly<Record<string, unknown>>,
  ) {
    super(id, 1);
  }

  static read(record: ArchiveRecord): RestoredPost {
    const content = record.attempt(() => PostContent.write(record.text('title'), record.body));
    const publishedAt = record.date('published');
    return new RestoredPost(
      record.id(),
      record.attempt(() => SlugPolicy.check(record.text('slug'))),
      record.oneOf('status', Post.STATUSES),
      content,
      record.texts('tags'),
      record.has('align') ? record.oneOf('align', Post.ALIGNS) : 'left',
      record.optionalId('cairn_main_wiki'),
      record.ids('cairn_ref_wikis'),
      publishedAt,
      publishedAt ?? record.createdAt,
      RestoredPost.photosOf(record),
      ArchiveFile.metaOf(record.unknownKeys(RestoredPost.KNOWN)),
    );
  }

  /** 글에 붙은 사진. 목록이 없는 옛 백업은 본문이 쓰는 사진(/api/files/<해시>)으로 알아낸다 */
  private static photosOf(record: ArchiveRecord): readonly string[] {
    if (!record.has('cairn_assets'))
      return [
        ...new Set([...record.body.matchAll(RestoredPost.FILE_REFERENCE)].map((m) => m[1] ?? '')),
      ];
    const hashes = record.texts('cairn_assets');
    const bad = hashes.find((hash) => !Blob.isHash(hash));
    if (bad !== undefined) throw record.problem(`cairn_assets의 해시가 틀렸어요: ${bad}`);
    return [...new Set(hashes)];
  }
}

// 복원에서 blog의 몫: 글과 사진. 글 → wiki 연결은 값이라 wiki가 묶음에 없어도(공개 저장소) 그대로 둔다.
// 글 자리 사본(vault.post_marks)은 vault의 몫이고, 이벤트를 남기지 않는다: 플러그인과 일꾼이 할 일이 생기지 않는다.
export class PostRestore extends ArchivePart {
  private static readonly POST = /^blog\/posts\/.+\.md$/;
  private static readonly PHOTO = /^assets\/([0-9a-f]{64})\.([a-z0-9]+)$/;

  private constructor(
    private readonly posts: readonly RestoredPost[],
    private readonly photos: ReadonlyMap<string, ArchiveBlob>,
  ) {
    super();
  }

  static read(files: readonly ArchiveFile[]): PostRestore {
    const posts: RestoredPost[] = [];
    const photos = new Map<string, ArchiveBlob>();
    for (const file of files) {
      if (PostRestore.POST.test(file.path)) {
        posts.push(RestoredPost.read(PostRestore.document(file, 'post', ArchiveQuery.FORMAT)));
      } else if (file.path.startsWith('assets/')) {
        const [hash, blob] = PostRestore.photo(file);
        photos.set(hash, blob);
      } else if (file.path.startsWith('blog/')) {
        throw new RuleViolation(`모르는 파일이에요: ${file.path}`);
      }
    }
    PostRestore.assertUnique(
      posts.map((p) => p.id),
      '글 id',
    );
    PostRestore.assertUnique(
      posts.map((p) => p.slug),
      '글 주소',
    );
    return new PostRestore(posts, photos);
  }

  /** 이름이 곧 내용의 해시인지, 파일의 앞부분이 확장자와 같은 사진인지 본다. SVG 같은 다른 형식은 들어오지 못한다 */
  private static photo(file: ArchiveFile): readonly [string, ArchiveBlob] {
    const [, hash = '', extension] = PostRestore.PHOTO.exec(file.path) ?? [];
    if (!hash) throw new RuleViolation(`모르는 파일이에요: ${file.path}`);
    if (createHash('sha256').update(file.body).digest('hex') !== hash)
      throw new RuleViolation(`${file.path}: 내용이 파일 이름의 해시와 달라요`);
    const mime = ImagePolicy.mimeOf(file.body);
    if (!mime || ImagePolicy.EXTENSIONS[mime] !== extension)
      throw new RuleViolation(`${file.path}: 확장자와 다른 형식의 파일이에요`);
    return [hash, new ArchiveBlob(file.body, mime)];
  }

  get counts(): ReadonlyMap<string, number> {
    return PostRestore.present([
      ['글', this.posts.length],
      ['사진', this.photos.size],
    ]);
  }

  override get blobs(): readonly ArchiveBlob[] {
    return [...this.photos.values()];
  }

  override get notes(): readonly string[] {
    const attached = new Set(this.posts.flatMap((p) => p.photos));
    const lost = [...attached].filter((hash) => !this.photos.has(hash)).length;
    const loose = [...this.photos.keys()].filter((hash) => !attached.has(hash)).length;
    return [
      ...(lost > 0 ? [`글이 쓰는데 묶음에 없는 사진 ${lost}개는 빠져요`] : []),
      ...(loose > 0 ? [`어느 글에도 붙지 않은 사진 ${loose}개는 다음 내보내기에서 빠져요`] : []),
    ];
  }

  async existing(tx: Sql): Promise<ReadonlyMap<string, number>> {
    const count = await new PostRestoreRepository(tx).existing();
    return PostRestore.present([['글', count]]);
  }

  async write(tx: Sql, spaceId: string): Promise<readonly string[]> {
    const repository = new PostRestoreRepository(tx);
    for (const post of this.posts) {
      const photos = post.photos.filter((hash) => this.photos.has(hash));
      await repository.save(spaceId, post, photos);
    }
    return [];
  }
}
