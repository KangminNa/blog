import { Module, type OnModuleInit } from '@nestjs/common';
import { BlobStore, CoreWorkers } from '../platform';
import { CategoryController } from './category/category.api';
import { CategoryQuery } from './category/category.query';
import { ChangeController } from './change/change.api';
import { ChangeQuery } from './change/change.query';
import { ChangeService } from './change/change.service';
import { SubmitChangesTool } from './change/change.tool';
import { ReviewPolicy } from './change/review.policy';
import { GraphController } from './graph/graph.api';
import { GraphQuery } from './graph/graph.query';
import { NeighborsTool } from './graph/graph.tool';
import { PostMarkHandler } from './post-mark/post-mark.handler';
import { PostMarkService } from './post-mark/post-mark.service';
import { PostWikiQuery } from './post-mark/post-wiki.query';
import { SessionController } from './session/session.api';
import { SessionQuery } from './session/session.query';
import { SessionService } from './session/session.service';
import {
  CheckSessionTool,
  GetSessionTool,
  SaveSessionTool,
  SearchSessionsTool,
} from './session/session.tool';
import { TidyController } from './tidy/tidy.api';
import { TidyQuery } from './tidy/tidy.query';
import { TidyService } from './tidy/tidy.service';
import { TidyRequestHandler } from './tidy/tidy-request.handler';
import { ArchiveController } from './vault-archive.api';
import { VaultArchiveQuery } from './vault-archive.query';
import { VaultTools } from './vault-tools';
import { WikiController } from './wiki/wiki.api';
import { WikiQuery } from './wiki/wiki.query';
import { GetWikiTool, SearchWikisTool } from './wiki/wiki.tool';
import { WikiScoreController } from './wiki-score/wiki-score.api';
import { WikiScoreQuery } from './wiki-score/wiki-score.query';

// AI 작업 세션과 그래프: 세션 저장·찾기·읽기, wiki · 카테고리, 변경 묶음(검토·되돌리기), 세션 정리 요청,
// 그래프 보기, 글 자리 사본, 보관 형식 내보내기, wiki 점수.
@Module({
  providers: [
    SessionService,
    SessionQuery,
    SaveSessionTool,
    CheckSessionTool,
    SearchSessionsTool,
    GetSessionTool,
    ReviewPolicy,
    ChangeService,
    ChangeQuery,
    SubmitChangesTool,
    WikiQuery,
    SearchWikisTool,
    GetWikiTool,
    WikiScoreQuery,
    CategoryQuery,
    TidyQuery,
    TidyService,
    TidyRequestHandler,
    PostMarkService,
    PostMarkHandler,
    PostWikiQuery,
    GraphQuery,
    NeighborsTool,
    VaultArchiveQuery,
    VaultTools,
  ],
  controllers: [
    SessionController,
    WikiController,
    WikiScoreController,
    CategoryController,
    ChangeController,
    TidyController,
    GraphController,
    ArchiveController,
  ],
  exports: [VaultTools, SessionQuery, PostWikiQuery],
})
export class VaultModule implements OnModuleInit {
  constructor(
    private readonly workers: CoreWorkers,
    private readonly tidy: TidyRequestHandler,
    private readonly postMarks: PostMarkHandler,
    private readonly blobs: BlobStore,
    private readonly sessions: SessionQuery,
    private readonly graph: GraphQuery,
  ) {}

  onModuleInit(): void {
    this.workers.on('vault.session.saved', this.tidy);
    this.workers.on('blog.post.*', this.postMarks);
    // 파일을 가리키는 칸: 쓰는 동안 platform이 파일을 지우지 않게
    this.blobs.registerUse(['vault.attachments.blob_hash'], (actor, hashes) =>
      this.sessions.usedBlobs(actor, hashes),
    );
    this.blobs.registerUse(['vault.graph_snapshots.blob_hash'], (actor, hashes) =>
      this.graph.usedBlobs(actor, hashes),
    );
  }
}
