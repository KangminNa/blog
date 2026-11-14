import type {
  ToolTextDetailView,
  ToolTextListView,
  ToolTextSavedView,
} from '../../../server/src/modules/mcp/tool-text/tool-text.view';

// mcp 모듈 응답의 타입. 서버 view에서 만든다 (손으로 적지 않는다)

export type ToolTextList = ReturnType<ToolTextListView['toJSON']>;
export type ToolTextDetail = ReturnType<ToolTextDetailView['toJSON']>;
export type ToolTextSaved = ReturnType<ToolTextSavedView['toJSON']>;
