import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, type Blob, BlobStore, Database, NotFound } from '../../platform';
import { Post } from '../post/post';

/** 내보낼 파일 하나: 정보와 내용. open: 방문자도 볼 수 있는 파일인가 */
export class AssetFile {
  private static readonly OPEN_CACHE = 'public, max-age=31536000, immutable';
  private static readonly PRIVATE_CACHE = 'no-store';

  constructor(
    readonly blob: Blob,
    readonly stream: Readable,
    private readonly open: boolean,
  ) {}

  /** 이름이 내용의 해시라 공개 파일은 바뀌지 않는다 */
  get cacheControl(): string {
    return this.open ? AssetFile.OPEN_CACHE : AssetFile.PRIVATE_CACHE;
  }
}

// 사진 읽기. 공개·링크 공개 글의 사진은 누구나, 나머지는 주인만.
// 임시·휴지통 글의 사진은 방문자에게 없는 파일과 똑같이 NotFound: 해시를 알아도 있는지조차 알 수 없게.
// 파일은 글마다 따로가 아니라 내용마다 하나라, 공개 글 하나에라도 붙어 있으면 공개다.
@Injectable()
export class AssetQuery extends BaseQuery {
  private static readonly MISSING = '파일을 찾을 수 없어요';

  constructor(
    db: Database,
    private readonly blobs: BlobStore,
  ) {
    super(db);
  }

  async file(actor: Actor, hash: string): Promise<AssetFile> {
    const open = await this.inOpenPost(hash);
    if (!open && actor.kind !== 'owner') throw new NotFound(AssetQuery.MISSING);
    const blob = await this.blobs.find(hash);
    if (!blob) throw new NotFound(AssetQuery.MISSING);
    return new AssetFile(blob, await this.blobs.open(hash), open);
  }

  private async inOpenPost(hash: string): Promise<boolean> {
    const [row] = await this.sql`
      SELECT EXISTS (
        SELECT 1 FROM blog.assets a JOIN blog.posts p ON p.id = a.post_id
        WHERE a.blob_hash = ${hash} AND p.deleted_at IS NULL
          AND p.status IN (${Post.PUBLISHED}, ${Post.UNLISTED})
      ) AS open`;
    return row?.open === true;
  }
}
