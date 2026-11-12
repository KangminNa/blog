import type { AssetView } from '../../../server/src/modules/blog/asset/asset.view';
import type {
  BasketItemView,
  BasketView,
} from '../../../server/src/modules/blog/basket/basket.view';
import type {
  PostCountsView,
  PostPageView,
  PostSummaryView,
  PostView,
  PublicPostPageView,
  PublicPostSummaryView,
  PublicPostView,
  SavedPostView,
} from '../../../server/src/modules/blog/post/post.view';

// 서버가 돌려주는 모양. import 없는 view 파일의 toJSON()이 원본이다 (객체설계 6장).
// 서버 코드가 웹 번들에 들어가지 않게 반드시 import type으로만 가져온다.

/** 글 목록의 한 줄 (방문자가 보는 것) */
export type PostSummary = ReturnType<PublicPostSummaryView['toJSON']>;
/** 관리 화면 글 목록의 한 줄 */
export type AdminPostSummary = ReturnType<PostSummaryView['toJSON']>;
/** 글의 공개 범위: 초안(나만) · 공개(목록에 보임) · 링크 공개(주소로만) */
export type PostStatus = AdminPostSummary['status'];
/** 관리 화면 탭의 글 수 */
export type PostCounts = ReturnType<PostCountsView['toJSON']>;
/** 목록 한 쪽 (방문자). next가 있으면 ?cursor=next로 다음 쪽 */
export type PostList = ReturnType<PublicPostPageView['toJSON']>;
/** 목록 한 쪽 (주인): 공개 범위와 탭별 글 수까지 */
export type AdminPostList = ReturnType<PostPageView['toJSON']>;
/** 주인이 불러오는 글 (편집기 · 결재): 공개 범위 · 버전 · wiki 연결까지 */
export type EditablePost = ReturnType<PostView['toJSON']>;
/** 글 페이지. 주인이 열면 공개 범위까지 온다 (초안 미리 보기) */
export type PostPage = ReturnType<PublicPostView['toJSON']> & Partial<Pick<EditablePost, 'status'>>;
/** 쓰기 결과 (편집기). revised: 이번 저장으로 새 판이 생겼나 */
export type SavedPost = ReturnType<SavedPostView['toJSON']>;
/** 올린 사진. url을 글 본문에 넣는다 */
export type Asset = ReturnType<AssetView['toJSON']>;
/** 소재 하나 (세션 · 글 · 링크 · 메모) */
export type BasketItem = ReturnType<BasketItemView['toJSON']>;
export type Basket = ReturnType<BasketView['toJSON']>;
