import type { CategoryListView } from '../../../server/src/modules/vault/category/category.view';
import type {
  ChangeSetView,
  WaitingChangePageView,
} from '../../../server/src/modules/vault/change/change.view';
import type { GraphView } from '../../../server/src/modules/vault/graph/graph.view';
import type {
  TidyBacklogView,
  TidySettingsView,
} from '../../../server/src/modules/vault/tidy/tidy.view';
import type {
  WikiDetailView,
  WikiPageView,
} from '../../../server/src/modules/vault/wiki/wiki.view';

// 서버가 돌려주는 모양. import 없는 view 파일의 toJSON()이 원본이다 (API설계 2장).
// 서버 코드가 웹 번들에 들어가지 않게 반드시 import type으로만 가져온다.

export type Graph = ReturnType<GraphView['toJSON']>;
export type GraphNode = Graph['nodes'][number];
export type WikiPage = ReturnType<WikiPageView['toJSON']>;
export type WikiSummary = WikiPage['wikis'][number];
export type WikiDetail = ReturnType<WikiDetailView['toJSON']>;
export type CategoryList = ReturnType<CategoryListView['toJSON']>;
export type WaitingChangePage = ReturnType<WaitingChangePageView['toJSON']>;
export type WaitingChange = WaitingChangePage['changes'][number];
export type ChangeSet = ReturnType<ChangeSetView['toJSON']>;
export type TidySettings = ReturnType<TidySettingsView['toJSON']>;
export type TidyBacklog = ReturnType<TidyBacklogView['toJSON']>;
