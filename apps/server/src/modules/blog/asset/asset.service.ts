import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, type Blob, BlobStore, Database } from '../../platform';
import { ReadPostInput } from '../post/post.input';
import { PostQuery } from '../post/post.query';
import { Asset } from './asset';
import { AssetRepository } from './asset.repository';

// 사진 올리기. 주인만. 파일은 트랜잭션 밖에서 쓰고, 트랜잭션은 "이 글의 사진" 행 하나만 남긴다.
// 행을 남기기 전에 멈추면 파일만 남는다. 내용 주소라 다시 올리면 그 파일을 그대로 쓴다.
@Injectable()
export class AssetService extends BaseService {
  constructor(
    db: Database,
    private readonly blobs: BlobStore,
    private readonly posts: PostQuery,
  ) {
    super(db);
  }

  /** mime은 입력 검사가 파일의 앞부분으로 정한 값이다. 없는 글·휴지통 글이면 파일을 쓰기 전에 NotFound */
  async upload(actor: Actor, postId: string, bytes: Buffer, mime: string): Promise<Blob> {
    actor.assertOwner();
    await this.posts.editable(actor, ReadPostInput.from(postId));
    const blob = await this.blobs.save(bytes, mime);
    await this.transaction((tx) => new AssetRepository(tx).save(Asset.open(postId, blob.hash)));
    return blob;
  }
}
