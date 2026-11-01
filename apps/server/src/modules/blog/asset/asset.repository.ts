import { BaseRepository, type Row } from '../../platform';
import { Asset } from './asset';

// blog.assets ↔ Asset. 같은 글에 같은 파일을 다시 올려도 행은 하나다.
export class AssetRepository extends BaseRepository<Asset> {
  protected toEntity(row: Row): Asset {
    return Asset.open(String(row.post_id), String(row.blob_hash));
  }

  async save(asset: Asset): Promise<void> {
    await this.sql`
      INSERT INTO blog.assets (post_id, blob_hash)
      VALUES (${asset.postId}, ${asset.blobHash})
      ON CONFLICT (post_id, blob_hash) DO NOTHING`;
    await this.publishEvents(asset);
  }
}
