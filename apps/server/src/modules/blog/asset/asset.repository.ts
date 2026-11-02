import { BaseRepository } from '../../platform';
import type { AssetRow } from '../blog.tables';
import { Asset } from './asset';

// blog.assets ↔ Asset. 같은 글에 같은 파일을 다시 올려도 행은 하나다.
// 기본키가 (글, 파일)이라 id와 version을 전제하는 TableRepository를 쓰지 않는다.
export class AssetRepository extends BaseRepository<Asset> {
  protected toEntity(row: AssetRow): Asset {
    return Asset.open(row.post_id, row.blob_hash);
  }

  async save(asset: Asset): Promise<void> {
    await this.sql`
      INSERT INTO blog.assets ${this.sql(asset.unsaved as never)}
      ON CONFLICT (post_id, blob_hash) DO NOTHING`;
    await this.publishEvents(asset);
  }
}
