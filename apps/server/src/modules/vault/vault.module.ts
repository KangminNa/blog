import { Module } from '@nestjs/common';
import { CategoryController } from './category/category.api';
import { CategoryQuery } from './category/category.query';
import { ChangeController } from './change/change.api';
import { ChangeQuery } from './change/change.query';
import { ChangeService } from './change/change.service';
import { SubmitChangesTool } from './change/change.tool';
import { ReviewPolicy } from './change/review.policy';
import { CheckSessionTool } from './session/check-session.tool';
import { GetSessionTool } from './session/get-session.tool';
import { SaveSessionTool } from './session/save-session.tool';
import { SearchSessionsTool } from './session/search-sessions.tool';
import { SensitivePolicy } from './session/sensitive.policy';
import { SessionController } from './session/session.controller';
import { SessionQuery } from './session/session.query';
import { SessionService } from './session/session.service';
import { ArchiveController } from './vault-archive.api';
import { VaultArchiveQuery } from './vault-archive.query';
import { VaultTools } from './vault-tools';
import { WikiController } from './wiki/wiki.api';
import { WikiQuery } from './wiki/wiki.query';
import { GetWikiTool, SearchWikisTool } from './wiki/wiki.tool';

// AI 작업 세션과 그래프: 세션 저장·찾기·읽기, wiki · 카테고리, 변경 묶음(검토·되돌리기), 보관 형식 내보내기.
@Module({
  providers: [
    SensitivePolicy,
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
    CategoryQuery,
    VaultArchiveQuery,
    VaultTools,
  ],
  controllers: [
    SessionController,
    WikiController,
    CategoryController,
    ChangeController,
    ArchiveController,
  ],
  exports: [VaultTools, SessionQuery],
})
export class VaultModule {}
