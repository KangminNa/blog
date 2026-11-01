import { Module } from '@nestjs/common';
import { VaultModule } from '../vault';
import { AssetController, FileController } from './asset/asset.api';
import { AssetQuery } from './asset/asset.query';
import { AssetService } from './asset/asset.service';
import { BasketController } from './basket/basket.api';
import { BasketQuery } from './basket/basket.query';
import { BasketService } from './basket/basket.service';
import { BasketGetTool } from './basket/basket.tool';
import { BlogTools } from './blog-tools';
import { PostController } from './post/post.controller';
import { PostQuery } from './post/post.query';
import { PostService } from './post/post.service';
import { BlogGetPostTool, BlogSaveDraftTool } from './post/post.tool';

// 방문자가 읽는 블로그와 글을 쓰는 재료: 글(쓰기·고치기·공개 범위·휴지통), 사진, 소재, AI 도구의 초안.
// vault는 소재의 세션을 확인할 때 Query로만 읽는다.
@Module({
  imports: [VaultModule],
  providers: [
    PostService,
    PostQuery,
    AssetService,
    AssetQuery,
    BasketService,
    BasketQuery,
    BlogGetPostTool,
    BlogSaveDraftTool,
    BasketGetTool,
    BlogTools,
  ],
  controllers: [PostController, AssetController, FileController, BasketController],
  exports: [BlogTools],
})
export class BlogModule {}
