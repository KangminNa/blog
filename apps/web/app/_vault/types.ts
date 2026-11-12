import type { CategoryListView } from '../../../server/src/modules/vault/category/category.view';
import type {
  ChangeSetView,
  WaitingChangePageView,
} from '../../../server/src/modules/vault/change/change.view';
import type { GraphView } from '../../../server/src/modules/vault/graph/graph.view';
import type {
  SessionDetailView,
  SessionPageView,
  SessionRevisionView,
} from '../../../server/src/modules/vault/session/session.view';
import type {
  TidyBacklogView,
  TidySettingsView,
} from '../../../server/src/modules/vault/tidy/tidy.view';
import type {
  WikiDetailView,
  WikiPageView,
  WikiTrashView,
} from '../../../server/src/modules/vault/wiki/wiki.view';
import type {
  WikiScoreBoardView,
  WikiScoreDetailView,
} from '../../../server/src/modules/vault/wiki-score/wiki-score.view';

// 서버가 돌려주는 모양. import 없는 view 파일의 toJSON()이 원본이다 (API설계 2장).
// 서버 코드가 웹 번들에 들어가지 않게 반드시 import type으로만 가져온다.

export type Graph = ReturnType<GraphView['toJSON']>;
export type GraphNode = Graph['nodes'][number];
/** 세션 목록 한 쪽. next가 있으면 ?cursor=next로 다음 쪽 */
export type SessionPage = ReturnType<SessionPageView['toJSON']>;
/** 세션의 판 하나: 그 판의 칸과 저장 전에 지운 비밀값 */
export type SessionRevision = ReturnType<SessionRevisionView['toJSON']>;
/** 세션 하나: 지금 판(head)과 판 기록 */
export type SessionDetail = ReturnType<SessionDetailView['toJSON']>;
export type WikiPage = ReturnType<WikiPageView['toJSON']>;
export type WikiSummary = WikiPage['wikis'][number];
export type WikiDetail = ReturnType<WikiDetailView['toJSON']>;
export type WikiTrash = ReturnType<WikiTrashView['toJSON']>;
export type TrashedWiki = WikiTrash['wikis'][number];
export type WikiScoreBoard = ReturnType<WikiScoreBoardView['toJSON']>;
export type WikiScoreItem = WikiScoreBoard['history'][number];
export type WikiScoreDetail = ReturnType<WikiScoreDetailView['toJSON']>;
export type CategoryList = ReturnType<CategoryListView['toJSON']>;
export type WaitingChangePage = ReturnType<WaitingChangePageView['toJSON']>;
export type WaitingChange = WaitingChangePage['changes'][number];
export type ChangeSet = ReturnType<ChangeSetView['toJSON']>;
export type TidySettings = ReturnType<TidySettingsView['toJSON']>;
export type TidyBacklog = ReturnType<TidyBacklogView['toJSON']>;
