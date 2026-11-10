import { Module, type OnModuleInit } from '@nestjs/common';
import { BlobStore, CoreWorkers } from '../platform';
import { VaultModule } from '../vault';
import { AssetController, FileController } from './asset/asset.api';
import { AssetQuery } from './asset/asset.query';
import { AssetService } from './asset/asset.service';
import { BasketController } from './basket/basket.api';
import { BasketQuery } from './basket/basket.query';
import { BasketService } from './basket/basket.service';
import { BasketGetTool } from './basket/basket.tool';
import { BlogTools } from './blog-tools';
import { PostController } from './post/post.api';
import { PostQuery } from './post/post.query';
import { PostService } from './post/post.service';
import { BlogGetPostTool, BlogSaveDraftTool } from './post/post.tool';
import { PostArchiveQuery } from './post/post-archive.query';
import { PublishApprovedHandler } from './post/publish-approved.handler';

// 방문자가 읽는 블로그와 글을 쓰는 재료: 글(쓰기·고치기·공개 범위·휴지통), 사진, 소재, AI 도구의 초안.
// vault는 소재의 세션을 확인할 때 Query로만 읽는다. 주인이 결재한 공개는 이벤트로 받아 실행한다 (task를 부르지 않는다).
@Module({
  imports: [VaultModule],
  providers: [
    PostService,
    PostQuery,
    PostArchiveQuery,
    AssetService,
    AssetQuery,
    BasketService,
    BasketQuery,
    BlogGetPostTool,
    BlogSaveDraftTool,
    BasketGetTool,
    BlogTools,
    PublishApprovedHandler,
  ],
  controllers: [PostController, AssetController, FileController, BasketController],
  exports: [BlogTools],
})
export class BlogModule implements OnModuleInit {
  constructor(
    private readonly workers: CoreWorkers,
    private readonly approved: PublishApprovedHandler,
    private readonly blobs: BlobStore,
    private readonly assets: AssetQuery,
    private readonly basket: BasketQuery,
  ) {}

  onModuleInit(): void {
    this.workers.on(PublishApprovedHandler.TOPIC, this.approved);
    this.workers.expect(PublishApprovedHandler.TOPIC);
    // 파일을 가리키는 칸: 쓰는 동안 platform이 파일을 지우지 않게
    this.blobs.registerUse(
      ['blog.assets.blob_hash', 'blog.posts.cover_blob_hash'],
      (actor, hashes) => this.assets.usedBlobs(actor, hashes),
    );
    this.blobs.registerUse(['work.basket_items.blob_hash'], (actor, hashes) =>
      this.basket.usedBlobs(actor, hashes),
    );
  }
}
